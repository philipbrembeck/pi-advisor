import { CONFIG_SCHEMA, configKeys } from "../config/schema.ts";
import type { ConfigKey } from "../config/schema.ts";
import type { AdvisorConfig } from "../config/types.ts";
import { validateConfig } from "../config/validation.ts";
import { isNumber, isRecord, isString } from "../content-utils.ts";
import type { JsonValue, RecordValue } from "../content-utils.ts";

const UI_ONLY_KEYS = new Set<ConfigKey>([
  "advisorJevBaseUrl",
  "advisorJevClassifier",
  "advisorJevKeyProvider",
  "advisorJevModel",
  "advisorJevPricePerMtok",
  "advisorJevTransport",
]);

const WRITABLE_KEYS = new Set<string>(
  configKeys.filter((key) => !UI_ONLY_KEYS.has(key))
);

export const ADVISOR_CONFIG_MODEL_KEYS = [
  "advisor",
  "advisorEffort",
  "advisorFallbackModel",
  "executor",
  "executorEffort",
] as const;

export const ADVISOR_CONFIG_EFFORT_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const ADVISOR_CONFIG_WRITABLE_KEYS = configKeys.filter(
  (key) => !UI_ONLY_KEYS.has(key)
);

export type AdvisorConfigPatch = {
  [Key in keyof AdvisorConfig]?: AdvisorConfig[Key] | null;
};

export type AdvisorConfigSnapshot = AdvisorConfig;

export const getAdvisorConfigSnapshot = (): AdvisorConfigSnapshot => {
  const snapshot = Object.fromEntries(
    configKeys.map((key) => [key, CONFIG_SCHEMA[key].current()])
  );

  // SAFETY: CONFIG_SCHEMA is exhaustive over AdvisorConfig, so this entry list has the exact config keys.
  return snapshot as AdvisorConfigSnapshot;
};

export const getAdvisorConfigForAgent = (persisted: RecordValue) => {
  const snapshot = getAdvisorConfigSnapshot();
  const keys = configKeys.filter((key) => !UI_ONLY_KEYS.has(key));

  const effectiveSettings = Object.fromEntries(
    keys.map((key) => [key, snapshot[key] ?? null])
  );

  const globalOverrides = Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(persisted, key))
      .map((key) => [key, persisted[key]])
  );

  return {
    effectiveSettings,
    globalOverrides,
    jevClassifierConfigured: Boolean(persisted.advisorJevClassifier),
    readOnlyKeys: [...UI_ONLY_KEYS].toSorted(),
    writableKeys: [...ADVISOR_CONFIG_WRITABLE_KEYS].toSorted(),
  };
};

export const validateAdvisorConfigPatch = (
  value: JsonValue,
  jevClassifierConfigured: boolean
): value is RecordValue & AdvisorConfigPatch => {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value);

  if (keys.length === 0) {
    throw new TypeError("Provide at least one Advisor setting to update.");
  }

  if (keys.length > 16) {
    throw new TypeError("Update at most 16 Advisor settings at a time.");
  }

  const unsupported = keys.filter((key) => !WRITABLE_KEYS.has(key));

  if (unsupported.length > 0) {
    throw new TypeError(
      `These Advisor settings require their dedicated UI flow: ${unsupported.map((key) => JSON.stringify(key)).join(", ")}. Use /advisor-settings for classifier and credential setup.`
    );
  }

  const setValues: RecordValue = {};

  for (const [key, setting] of Object.entries(value)) {
    if (setting !== null) {
      setValues[key] = setting;
    }
  }

  if (!validateConfig(setValues, "advisor_config changes")) {
    return false;
  }

  const effortLevels: readonly string[] = ADVISOR_CONFIG_EFFORT_LEVELS;

  for (const key of ["advisorEffort", "executorEffort"] as const) {
    const effort = setValues[key];

    if (isString(effort) && !effortLevels.includes(effort)) {
      throw new TypeError(
        `${key} must be one of ${ADVISOR_CONFIG_EFFORT_LEVELS.join(", ")}; use null for the model default.`
      );
    }
  }

  if (value.advisor === null) {
    throw new TypeError(
      "The Advisor model cannot be cleared from chat. Choose another model with the picker or use /advisor-models."
    );
  }

  const turnGateEveryTurns = isNumber(setValues.advisorJevTurnGateEveryTurns)
    ? setValues.advisorJevTurnGateEveryTurns
    : 0;

  if (
    (setValues.advisorJevFilterEnabled === true || turnGateEveryTurns > 0) &&
    !jevClassifierConfigured
  ) {
    throw new TypeError(
      "Select and verify a Jev classifier in /advisor-settings before enabling Jev screening or the turn gate. No settings were changed."
    );
  }

  return true;
};

export const addAdvisorConfigDependencies = (changes: AdvisorConfigPatch) => {
  const normalized = { ...changes };

  if (changes.advisorToolsEnabled === false) {
    if (changes.alwaysOn === true) {
      throw new TypeError(
        "Advisor tools cannot be disabled while Always on is enabled in the same update. Set both to false."
      );
    }

    normalized.alwaysOn = false;
  }

  if (changes.alwaysOn === true) {
    if (changes.advisorToolsEnabled === false) {
      throw new TypeError(
        "Always on requires Advisor tools. Enable both or keep Always on off."
      );
    }

    normalized.advisorToolsEnabled = true;
  }

  return normalized;
};
