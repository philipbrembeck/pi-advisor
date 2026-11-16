import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isRecord, isString } from "../content-utils.ts";
import type { JsonValue, RecordValue } from "../content-utils.ts";
import { t } from "../i18n.ts";
import { applyConfig, resetDefaults } from "./defaults.ts";
import {
  CONFIG_SCHEMA,
  configuredModelRef,
  SAVED_CONFIG_KEYS,
} from "./schema.ts";
import type { PersistedConfigKey } from "./schema.ts";
import {
  applySessionActivationOverrides,
  clearSessionActivationOverrides,
} from "./session-overrides.ts";
import {
  advisorActivationRef,
  advisorJevClassifierRef,
  advisorJevFilterEnabledRef,
  setAdvisorOutcomeLoggingRef,
  setPersistedModelRefs,
} from "./state.ts";
import type { AdvisorConfig } from "./types.ts";
import { unknownConfigKeys, validateConfig } from "./validation.ts";

export const configPaths = (ctx: ExtensionContext) => [
  ctx.isProjectTrusted()
    ? join(ctx.cwd, CONFIG_DIR_NAME, "advisor.json")
    : null,
  join(getAgentDir(), "advisor.json"),
];

type SavedConfigKey = PersistedConfigKey;

type ConfigState = {
  [Key in SavedConfigKey]: AdvisorConfig[Key];
};

const currentConfigState = (): ConfigState =>
  // SAFETY: SAVED_CONFIG_KEYS enumerates exactly the ConfigState keys, so fromEntries yields ConfigState.
  Object.fromEntries(
    SAVED_CONFIG_KEYS.map((key) => [key, CONFIG_SCHEMA[key].current()])
  ) as ConfigState;

const sameConfigValue = <Value>(left: Value, right: Value) =>
  JSON.stringify(left) === JSON.stringify(right);

const CONFIG_KEY_SET = new Set<string>(Object.keys(CONFIG_SCHEMA));

/** Keys advisor.json may hold that are not AdvisorConfig settings but are
 * still legitimate (hand-placed secrets). They stay out of CONFIG_SCHEMA, are
 * preserved like any unknown key, and never trigger the typo warning. */
const RESERVED_ADVISOR_JSON_KEYS = new Set(["typesafe_api_key"]);

export const readExistingConfig = (path: string): RecordValue => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));

    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const readConfigForSave = (path: string): RecordValue => {
  if (!existsSync(path)) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new Error(
      `Cannot save Advisor configuration at ${path}: existing JSON is malformed; fix advisor.json before saving.`,
      { cause: error }
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      `Cannot save Advisor configuration at ${path}: configuration must be a JSON object.`
    );
  }

  return parsed;
};

const shouldPersistConfigKey = (
  key: SavedConfigKey,
  persistAdvisor: boolean,
  persistExecutor: boolean
) =>
  (key !== "advisor" || persistAdvisor) &&
  (key !== "executor" || persistExecutor);

const applyChangedConfigValues = (
  existing: RecordValue,
  current: ConfigState,
  changedKeys: readonly SavedConfigKey[],
  persistAdvisor: boolean,
  persistExecutor: boolean
): RecordValue => {
  const dropped = new Set<string>();
  const data: RecordValue = { ...existing };

  for (const key of changedKeys) {
    if (!shouldPersistConfigKey(key, persistAdvisor, persistExecutor)) {
      continue;
    }

    const value = current[key];
    const isEmptyModelRef = (key === "advisor" || key === "executor") && !value;

    if (value === undefined || isEmptyModelRef) {
      dropped.add(key);
    } else {
      data[key] = value;
    }
  }

  if (dropped.size === 0) {
    return data;
  }

  const retained: RecordValue = {};

  for (const key of Object.keys(data)) {
    if (!dropped.has(key)) {
      retained[key] = data[key];
    }
  }

  return retained;
};

// Tracks the last load/save state so a later save merges fresh disk contents instead of overwriting an external edit.
let loadedConfigState: ConfigState | undefined;
let loadedConfigPath: string | undefined;

const readConfig = (path: string): AdvisorConfig => {
  const config = JSON.parse(readFileSync(path, "utf-8"));
  validateConfig(config, path);

  return config;
};

// loadConfig runs per tool call and consultation; caching by path and stat
// identity keeps the parse off the hot path while still reset-applying each call.
const configCache = new Map<
  string,
  { config: AdvisorConfig; identity: string }
>();

const warnedUnknownConfigIdentities = new Set<string>();
const warnedFilterWithoutClassifierIdentities = new Set<string>();

/** Drops the parsed-configuration cache; the next load re-reads from disk. */
export const resetConfigCache = () => {
  configCache.clear();
  warnedUnknownConfigIdentities.clear();
  warnedFilterWithoutClassifierIdentities.clear();
};

/**
 * Nanosecond timestamps plus size and inode so a same-millisecond or
 * same-size external rewrite cannot be served from the cache. An unstattable
 * path yields a unique value, which always forces a re-read.
 */
const configIdentity = (path: string): string => {
  try {
    const stats = statSync(path, { bigint: true });

    return `${stats.mtimeNs}:${stats.ctimeNs}:${stats.size}:${stats.ino}:${stats.dev}`;
  } catch {
    return `unstattable:${process.hrtime.bigint()}`;
  }
};

const configFileIdentity = (path: string) =>
  existsSync(path) ? configIdentity(path) : null;

const readConfigCached = (path: string): AdvisorConfig => {
  const identity = configIdentity(path);
  const cached = configCache.get(path);

  if (cached?.identity === identity) {
    return cached.config;
  }

  const config = readConfig(path);
  configCache.set(path, { config, identity });

  return config;
};

export const loadConfig = (_ctx: ExtensionContext) => {
  resetDefaults();
  const global = join(getAgentDir(), "advisor.json");

  const globalConfig = existsSync(global)
    ? readConfigCached(global)
    : undefined;

  setPersistedModelRefs(
    configuredModelRef(globalConfig?.advisor),
    configuredModelRef(globalConfig?.executor)
  );

  if (globalConfig) {
    applyConfig(globalConfig);

    const warningIdentity = `${global}:${configIdentity(global)}`;

    if (
      advisorJevFilterEnabledRef &&
      !advisorJevClassifierRef &&
      _ctx.hasUI &&
      !warnedFilterWithoutClassifierIdentities.has(warningIdentity)
    ) {
      warnedFilterWithoutClassifierIdentities.add(warningIdentity);
      _ctx.ui.notify(
        t(
          "notify.jevFilterNoClassifier.message",
          "The Jev consultation filter is enabled but no Jev classifier is selected; consultations are not screened until you pick one in /advisor-settings."
        ),
        "warning"
      );
    }

    const unknownKeys = unknownConfigKeys(globalConfig).filter(
      (key) => !RESERVED_ADVISOR_JSON_KEYS.has(key)
    );

    if (
      unknownKeys.length > 0 &&
      _ctx.hasUI &&
      !warnedUnknownConfigIdentities.has(warningIdentity)
    ) {
      _ctx.ui.notify(
        `${t("notify.unknownConfigKeys.at", "Advisor configuration at")} ${global} ${t("notify.unknownConfigKeys.contains", "contains unrecognized key(s)")} ${unknownKeys.map((key) => JSON.stringify(key)).join(", ")}. ${t("notify.unknownConfigKeys.preserved", "They were preserved but ignored; check for typos or upgrade pi-advisor.")}`,
        "warning"
      );
      warnedUnknownConfigIdentities.add(warningIdentity);
    }
  }

  // Repository-controlled project configuration is never applied. Models,
  // prompts, gates, budgets, disclosure, redaction, integrations, and consent
  // remain under the user's global Pi configuration.
  if (advisorActivationRef === "session") {
    applySessionActivationOverrides(_ctx);
  } else {
    clearSessionActivationOverrides(_ctx);
  }

  setAdvisorOutcomeLoggingRef(globalConfig?.advisorOutcomeLogging === true);
  loadedConfigState = currentConfigState();
  loadedConfigPath = global;

  return existsSync(global) ? global : null;
};

/**
 * Saves user-controlled configuration globally without outcome consent.
 *
 * Only values changed since the last load/save are written. This lets an
 * external edit to advisor.json coexist with a later settings or model save.
 */
export interface SaveConfigOptions {
  forceKeys?: readonly PersistedConfigKey[];
  persistAdvisor?: boolean;
  persistExecutor?: boolean;
}

/** Marks the current live state as the new diff baseline without writing it. */
export const rebaseConfigBaseline = () => {
  loadedConfigState = currentConfigState();
  loadedConfigPath = join(getAgentDir(), "advisor.json");
};

export const saveConfig = (
  _ctx: ExtensionContext,
  options: SaveConfigOptions = {}
) => {
  const path = join(getAgentDir(), "advisor.json");
  const persistAdvisor = options.persistAdvisor ?? true;
  const persistExecutor = options.persistExecutor ?? true;
  const current = currentConfigState();
  const baseline = loadedConfigPath === path ? loadedConfigState : undefined;
  const forcedKeys = new Set(options.forceKeys);

  const changedKeys = baseline
    ? SAVED_CONFIG_KEYS.filter(
        (key) =>
          forcedKeys.has(key) || !sameConfigValue(current[key], baseline[key])
      )
    : [...SAVED_CONFIG_KEYS];

  if (changedKeys.length === 0) {
    return path;
  }

  const existing = readConfigForSave(path);

  const data = applyChangedConfigValues(
    existing,
    current,
    changedKeys,
    persistAdvisor,
    persistExecutor
  );

  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  resetConfigCache();
  const nextLoadedState = { ...current };

  if (!persistAdvisor) {
    nextLoadedState.advisor = baseline
      ? baseline.advisor
      : configuredModelRef(
          isString(existing.advisor) ? existing.advisor : undefined
        );
  }

  if (!persistExecutor) {
    nextLoadedState.executor = baseline
      ? baseline.executor
      : configuredModelRef(
          isString(existing.executor) ? existing.executor : undefined
        );
  }

  loadedConfigState = nextLoadedState;
  loadedConfigPath = path;
  setPersistedModelRefs(
    configuredModelRef(nextLoadedState.advisor),
    configuredModelRef(nextLoadedState.executor)
  );

  return path;
};

const writeConfigAtomically = (
  path: string,
  contents: string,
  expectedIdentity?: string | null
) => {
  const mode = existsSync(path) ? statSync(path).mode % 0o1000 : 0o600;
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fileDescriptor: number | undefined;

  try {
    fileDescriptor = openSync(temporaryPath, "wx", mode);
    writeFileSync(fileDescriptor, contents, "utf-8");
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = undefined;

    if (
      expectedIdentity !== undefined &&
      configFileIdentity(path) !== expectedIdentity
    ) {
      throw new Error(
        "Advisor configuration changed during the update; retry so unrelated edits are preserved."
      );
    }

    renameSync(temporaryPath, path);
  } catch (error) {
    if (fileDescriptor !== undefined) {
      closeSync(fileDescriptor);
    }

    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created.
    }

    throw error;
  }
};

/** Outcome logging is deliberately written only to the global Pi configuration. */
export const saveGlobalOutcomeLogging = (
  enabled: boolean | null,
  expected?: Readonly<Record<string, JsonValue>>,
  expectedKeys: readonly string[] = ["advisorOutcomeLogging"]
) => {
  const path = join(getAgentDir(), "advisor.json");
  const identity = configFileIdentity(path);
  const existing = readConfigForSave(path);

  if (
    expected &&
    expectedKeys.some(
      (key) =>
        Object.hasOwn(existing, key) !== Object.hasOwn(expected, key) ||
        !sameConfigValue(existing[key], expected[key])
    )
  ) {
    throw new Error(
      "Advisor settings changed during confirmation; read the settings again and retry."
    );
  }

  if (enabled === null) {
    Reflect.deleteProperty(existing, "advisorOutcomeLogging");
  } else {
    existing.advisorOutcomeLogging = enabled;
  }

  writeConfigAtomically(
    path,
    `${JSON.stringify(existing, null, 2)}\n`,
    identity
  );
  resetConfigCache();

  return path;
};

/** Applies a validated sparse patch to global advisor.json while preserving
 * unrelated and unknown fields. A null value removes that setting override. */
export const readGlobalAdvisorConfig = () => {
  const path = join(getAgentDir(), "advisor.json");
  const config = readConfigForSave(path);
  validateConfig(config, path);

  return config;
};

export const saveGlobalAdvisorConfigPatch = (
  patch: Readonly<Record<string, JsonValue | null>>,
  expected?: Readonly<Record<string, JsonValue>>,
  expectedKeys?: readonly string[]
) => {
  const path = join(getAgentDir(), "advisor.json");

  const unknownKeys = Object.keys(patch).filter(
    (key) => !CONFIG_KEY_SET.has(key)
  );

  if (unknownKeys.length > 0) {
    throw new Error(
      `Cannot update Advisor configuration: unsupported key(s) ${unknownKeys.map((key) => JSON.stringify(key)).join(", ")}.`
    );
  }

  const identity = configFileIdentity(path);
  const next = readConfigForSave(path);

  const checkedKeys = expectedKeys ?? Object.keys(patch);

  if (
    expected &&
    checkedKeys.some(
      (key) =>
        Object.hasOwn(next, key) !== Object.hasOwn(expected, key) ||
        !sameConfigValue(next[key], expected[key])
    )
  ) {
    throw new Error(
      "Advisor settings changed during confirmation; read the settings again and retry."
    );
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      Reflect.deleteProperty(next, key);
    } else {
      next[key] = value;
    }
  }

  validateConfig(next, path);
  writeConfigAtomically(path, `${JSON.stringify(next, null, 2)}\n`, identity);
  resetConfigCache();

  return path;
};
