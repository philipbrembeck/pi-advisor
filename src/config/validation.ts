import { isBoolean, isRecord, isString } from "../content-utils.ts";
import type { JsonValue } from "../content-utils.ts";
import type { ConfigKey, ConfigKeySchema } from "./schema.ts";
import { configKeys, SCHEMA_BY_KEY } from "./schema.ts";
import type { AdvisorConfig } from "./types.ts";

// Re-exports keep the isValid* validators on their historical module for the config facade.
export {
  isValidAdvisorModelWhitelist,
  isValidAdvisorToolPolicies,
  isValidContextMaxChars,
  isValidGateFailureMode,
  isValidLoopThreshold,
  isValidMaxCallsPerSession,
  isValidToolResultMaxBytes,
  isValidToolResultMaxLines,
} from "./schema.ts";

const CONFIG_KEYS = new Set<string>(configKeys);

const keysOfType = (type: ConfigKeySchema["type"]): readonly ConfigKey[] =>
  configKeys.filter((key) => SCHEMA_BY_KEY[key].type === type);

const BOOLEAN_CONFIG_KEYS = keysOfType("boolean");
const STRING_CONFIG_KEYS = keysOfType("string");

type ConfigRecord = Record<string, JsonValue>;

const invalidConfigValue = (
  path: string,
  key: string,
  accepted: string
): never => {
  throw new TypeError(
    `Invalid advisor configuration at ${path}, key ${JSON.stringify(key)}: expected ${accepted}.`
  );
};

export const unknownConfigKeys = (config: AdvisorConfig) =>
  Object.keys(config).filter((key) => !CONFIG_KEYS.has(key));

const validateStringValues = (config: ConfigRecord, path: string) => {
  for (const key of STRING_CONFIG_KEYS) {
    if (config[key] !== undefined && !isString(config[key])) {
      invalidConfigValue(path, key, SCHEMA_BY_KEY[key].accepted);
    }
  }
};

const validateBooleanValues = (config: ConfigRecord, path: string) => {
  for (const key of BOOLEAN_CONFIG_KEYS) {
    if (config[key] !== undefined && !isBoolean(config[key])) {
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

const validateArrayValues = (config: ConfigRecord, path: string) => {
  for (const key of keysOfType("array")) {
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
  if (!isRecord(value)) {
    throw new TypeError(
      `Invalid advisor configuration at ${path}: expected a JSON object.`
    );
  }
  validateStringValues(value, path);
  validateBooleanValues(value, path);
  validateNumericValues(value, path);
  validateObjectValues(value, path);
  validateArrayValues(value, path);
  validateEnumValues(value, path);
  return true;
};
