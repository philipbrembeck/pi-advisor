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

const validateValues = (
  config: ConfigRecord,
  path: string,
  type: ConfigKeySchema["type"]
) => {
  for (const key of keysOfType(type)) {
    const value = config[key];
    if (value === undefined) {
      continue;
    }
    const schema = SCHEMA_BY_KEY[key];
    if (type === "string" || type === "boolean") {
      const matchesType =
        type === "string" ? isString(value) : isBoolean(value);
      if (!matchesType) {
        invalidConfigValue(path, key, schema.accepted);
      }
    }
    if (schema.validate && !schema.validate(value)) {
      invalidConfigValue(path, key, schema.accepted);
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
  validateValues(value, path, "string");
  validateValues(value, path, "boolean");
  validateValues(value, path, "number");
  validateValues(value, path, "object");
  validateValues(value, path, "array");
  validateValues(value, path, "enum");
  return true;
};
