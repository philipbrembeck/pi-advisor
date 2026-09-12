import type { ConfigKeySchema } from "./schema.ts";
import { CONFIG_SCHEMA, type ConfigKey, SCHEMA_BY_KEY } from "./schema.ts";
import type { AdvisorConfig } from "./types.ts";

// biome-ignore lint/performance/noBarrelFile: re-exports keep the isValid* validators on their historical module for the config facade.
export {
  isValidAdvisorToolPolicies,
  isValidContextMaxChars,
  isValidGateFailureMode,
  isValidLoopThreshold,
  isValidMaxCallsPerSession,
  isValidToolResultMaxBytes,
  isValidToolResultMaxLines,
} from "./schema.ts";

const CONFIG_KEYS = new Set<ConfigKey>(
  Object.keys(CONFIG_SCHEMA) as ConfigKey[]
);

const keysOfType = (type: ConfigKeySchema["type"]): readonly ConfigKey[] =>
  (Object.keys(CONFIG_SCHEMA) as ConfigKey[]).filter(
    (key) => SCHEMA_BY_KEY[key].type === type
  );

const BOOLEAN_CONFIG_KEYS = keysOfType("boolean");
const STRING_CONFIG_KEYS = keysOfType("string");

type ConfigRecord = Record<string, unknown>;

const invalidConfigValue = (
  path: string,
  key: string,
  accepted: string
): never => {
  throw new TypeError(
    `Invalid advisor configuration at ${path}, key ${JSON.stringify(key)}: expected ${accepted}.`
  );
};

export const unknownConfigKeys = (config: ConfigRecord) =>
  Object.keys(config).filter((key) => !CONFIG_KEYS.has(key as ConfigKey));

const validateStringValues = (config: ConfigRecord, path: string) => {
  for (const key of STRING_CONFIG_KEYS) {
    if (config[key] !== undefined && typeof config[key] !== "string") {
      invalidConfigValue(path, key, SCHEMA_BY_KEY[key].accepted);
    }
  }
};

const validateBooleanValues = (config: ConfigRecord, path: string) => {
  for (const key of BOOLEAN_CONFIG_KEYS) {
    if (config[key] !== undefined && typeof config[key] !== "boolean") {
      invalidConfigValue(path, key, SCHEMA_BY_KEY[key].accepted);
    }
  }
};

const validateNumericValues = (config: ConfigRecord, path: string) => {
  for (const key of keysOfType("number")) {
    const isValid = SCHEMA_BY_KEY[key].validate;
    if (
      config[key] !== undefined &&
      isValid !== undefined &&
      !isValid(config[key])
    ) {
      invalidConfigValue(path, key, SCHEMA_BY_KEY[key].accepted);
    }
  }
};

const validateEnumValues = (config: ConfigRecord, path: string) => {
  for (const key of keysOfType("enum")) {
    const isValid = SCHEMA_BY_KEY[key].validate;
    if (
      config[key] !== undefined &&
      isValid !== undefined &&
      !isValid(config[key])
    ) {
      invalidConfigValue(path, key, SCHEMA_BY_KEY[key].accepted);
    }
  }
};

const validateObjectValues = (config: ConfigRecord, path: string) => {
  for (const key of keysOfType("object")) {
    const isValid = SCHEMA_BY_KEY[key].validate;
    if (
      config[key] !== undefined &&
      isValid !== undefined &&
      !isValid(config[key])
    ) {
      invalidConfigValue(path, key, SCHEMA_BY_KEY[key].accepted);
    }
  }
};

export const validateConfig = (
  value: unknown,
  path = "advisor.json"
): value is AdvisorConfig => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      `Invalid advisor configuration at ${path}: expected a JSON object.`
    );
  }
  const config = value as ConfigRecord;
  validateStringValues(config, path);
  validateBooleanValues(config, path);
  validateNumericValues(config, path);
  validateObjectValues(config, path);
  validateEnumValues(config, path);
  return true;
};
