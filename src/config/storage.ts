import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { applyConfig, resetDefaults } from "./defaults.ts";
import {
  CONFIG_SCHEMA,
  configuredModelRef,
  type PersistedConfigKey,
  SAVED_CONFIG_KEYS,
} from "./schema.ts";
import { setAdvisorOutcomeLoggingRef, setPersistedModelRefs } from "./state.ts";
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
  Object.fromEntries(
    SAVED_CONFIG_KEYS.map((key) => [key, CONFIG_SCHEMA[key].current()])
  ) as ConfigState;

const sameConfigValue = <Value>(left: Value, right: Value) =>
  JSON.stringify(left) === JSON.stringify(right);

const readExistingConfig = (path: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const shouldPersistConfigKey = (
  key: SavedConfigKey,
  persistAdvisor: boolean,
  persistExecutor: boolean
) =>
  (key !== "advisor" || persistAdvisor) &&
  (key !== "executor" || persistExecutor);

const applyChangedConfigValues = (
  data: Record<string, unknown>,
  current: ConfigState,
  changedKeys: readonly SavedConfigKey[],
  persistAdvisor: boolean,
  persistExecutor: boolean
) => {
  for (const key of changedKeys) {
    if (!shouldPersistConfigKey(key, persistAdvisor, persistExecutor)) {
      continue;
    }
    const value = current[key];
    const isEmptyModelRef = (key === "advisor" || key === "executor") && !value;
    if (value === undefined || isEmptyModelRef) {
      delete data[key];
    } else {
      data[key] = value;
    }
  }
};

// Tracks the last load/save state so a later save merges fresh disk contents instead of overwriting an external edit.
let loadedConfigState: ConfigState | undefined;
let loadedConfigPath: string | undefined;

const readConfig = (path: string): AdvisorConfig => {
  const config = JSON.parse(readFileSync(path, "utf8"));
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

/** Drops the parsed-configuration cache; the next load re-reads from disk. */
export const resetConfigCache = () => {
  configCache.clear();
  warnedUnknownConfigIdentities.clear();
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
    const unknownKeys = unknownConfigKeys(
      globalConfig as Record<string, unknown>
    );
    const warningIdentity = `${global}:${configIdentity(global)}`;
    if (
      unknownKeys.length > 0 &&
      _ctx.hasUI &&
      !warnedUnknownConfigIdentities.has(warningIdentity)
    ) {
      _ctx.ui.notify(
        `Advisor configuration at ${global} contains unrecognized key(s) ${unknownKeys.map((key) => JSON.stringify(key)).join(", ")}. They were preserved but ignored; check for typos or upgrade pi-advisor.`,
        "warning"
      );
      warnedUnknownConfigIdentities.add(warningIdentity);
    }
  }
  // Repository-controlled project configuration is never applied. Models,
  // prompts, gates, budgets, disclosure, redaction, integrations, and consent
  // remain under the user's global Pi configuration.
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
  persistAdvisor?: boolean;
  persistExecutor?: boolean;
}

export const saveConfig = (
  _ctx: ExtensionContext,
  options: SaveConfigOptions = {}
) => {
  const path = join(getAgentDir(), "advisor.json");
  const persistAdvisor = options.persistAdvisor ?? true;
  const persistExecutor = options.persistExecutor ?? true;
  const existing = readExistingConfig(path);
  const current = currentConfigState();
  const baseline = loadedConfigPath === path ? loadedConfigState : undefined;
  const changedKeys = baseline
    ? SAVED_CONFIG_KEYS.filter(
        (key) => !sameConfigValue(current[key], baseline[key])
      )
    : [...SAVED_CONFIG_KEYS];
  if (changedKeys.length === 0) {
    return path;
  }
  const data = { ...existing };
  applyChangedConfigValues(
    data,
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
          typeof existing.advisor === "string" ? existing.advisor : undefined
        );
  }
  if (!persistExecutor) {
    nextLoadedState.executor = baseline
      ? baseline.executor
      : configuredModelRef(
          typeof existing.executor === "string" ? existing.executor : undefined
        );
  }
  loadedConfigState = nextLoadedState;
  loadedConfigPath = path;
  return path;
};

/** Outcome logging is deliberately written only to the global Pi configuration. */
export const saveGlobalOutcomeLogging = (enabled: boolean) => {
  const path = join(getAgentDir(), "advisor.json");
  const existing = readExistingConfig(path);
  writeFileSync(
    path,
    `${JSON.stringify({ ...existing, advisorOutcomeLogging: enabled }, null, 2)}\n`
  );
  resetConfigCache();
  return path;
};
