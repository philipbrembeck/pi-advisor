import { GIT_CONTEXT_LEVELS, isValidGitContextLevel } from "../git.ts";
import {
  ADVISOR_TOOL_POLICIES,
  type AdvisorConfig,
  GATE_FAILURE_MODES,
  MAX_CONTEXT_MAX_CHARS,
} from "./types.ts";

const CONFIG_KEYS = new Set<keyof AdvisorConfig>([
  "advisor",
  "advisorAutoLoopGate",
  "advisorBlockOnBlocked",
  "advisorCollapseResponses",
  "advisorCompletionGate",
  "advisorCustomInvocation",
  "advisorEffort",
  "advisorFailureGate",
  "advisorGitContext",
  "advisorGitContextMaxChars",
  "advisorHerdrIntegration",
  "advisorLoopThreshold",
  "advisorMaxCallsPerSession",
  "advisorPlanGate",
  "advisorSessionSummary",
  "advisorScoutEnabled",
  "showUsageDetails",
  "showUsageFooter",
  "simpleMode",
  "alwaysOn",
  "advisorToolResultMaxBytes",
  "advisorToolResultMaxLines",
  "advisorTrackedFileContent",
  "advisorRedactSecrets",
  "advisorUntrackedContent",
  "advisorOutcomeLogging",
  "advisorToolPolicies",
  "contextMaxChars",
  "executor",
  "executorEffort",
  "gateFailureMode",
]);

const BOOLEAN_CONFIG_KEYS = [
  "advisorPlanGate",
  "advisorFailureGate",
  "advisorCompletionGate",
  "advisorCollapseResponses",
  "advisorBlockOnBlocked",
  "advisorAutoLoopGate",
  "advisorSessionSummary",
  "advisorScoutEnabled",
  "showUsageDetails",
  "showUsageFooter",
  "simpleMode",
  "alwaysOn",
  "advisorHerdrIntegration",
  "advisorTrackedFileContent",
  "advisorRedactSecrets",
  "advisorUntrackedContent",
  "advisorOutcomeLogging",
] as const;

const STRING_CONFIG_KEYS = [
  "executor",
  "advisor",
  "executorEffort",
  "advisorEffort",
  "advisorCustomInvocation",
] as const;

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
  Object.keys(config).filter(
    (key) => !CONFIG_KEYS.has(key as keyof AdvisorConfig)
  );

const validateStringValues = (config: ConfigRecord, path: string) => {
  for (const key of STRING_CONFIG_KEYS) {
    if (config[key] !== undefined && typeof config[key] !== "string") {
      invalidConfigValue(
        path,
        key,
        key === "executor" || key === "advisor"
          ? "a provider/model string"
          : "a string"
      );
    }
  }
};

const validateBooleanValues = (config: ConfigRecord, path: string) => {
  for (const key of BOOLEAN_CONFIG_KEYS) {
    if (config[key] !== undefined && typeof config[key] !== "boolean") {
      invalidConfigValue(path, key, "true or false");
    }
  }
};

export const isValidAdvisorToolPolicies = (
  value: unknown
): value is Record<string, (typeof ADVISOR_TOOL_POLICIES)[number]> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([toolName, policy]) =>
      toolName.trim().length > 0 &&
      typeof policy === "string" &&
      ADVISOR_TOOL_POLICIES.includes(
        policy as (typeof ADVISOR_TOOL_POLICIES)[number]
      )
  );
};

export const isValidContextMaxChars = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_CONTEXT_MAX_CHARS;

export const isValidLoopThreshold = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 2;

export const isValidMaxCallsPerSession = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const isValidGateFailureMode = (
  value: unknown
): value is (typeof GATE_FAILURE_MODES)[number] =>
  typeof value === "string" &&
  GATE_FAILURE_MODES.includes(value as (typeof GATE_FAILURE_MODES)[number]);

export const isValidToolResultMaxLines = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const isValidToolResultMaxBytes = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const validateNumericValues = (config: ConfigRecord, path: string) => {
  const numericRules: [
    keyof AdvisorConfig,
    (value: unknown) => boolean,
    string,
  ][] = [
    [
      "contextMaxChars",
      isValidContextMaxChars,
      `a safe integer from 0 through ${MAX_CONTEXT_MAX_CHARS}`,
    ],
    [
      "advisorLoopThreshold",
      isValidLoopThreshold,
      "a safe integer of at least 2",
    ],
    [
      "advisorMaxCallsPerSession",
      isValidMaxCallsPerSession,
      "a non-negative safe integer",
    ],
    [
      "advisorToolResultMaxLines",
      isValidToolResultMaxLines,
      "a non-negative safe integer",
    ],
    [
      "advisorToolResultMaxBytes",
      isValidToolResultMaxBytes,
      "a non-negative safe integer",
    ],
    [
      "advisorGitContextMaxChars",
      isValidToolResultMaxBytes,
      "a non-negative safe integer",
    ],
  ];
  for (const [key, isValid, description] of numericRules) {
    if (config[key] !== undefined && !isValid(config[key])) {
      invalidConfigValue(path, key, description);
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
  if (
    config.advisorToolPolicies !== undefined &&
    !isValidAdvisorToolPolicies(config.advisorToolPolicies)
  ) {
    invalidConfigValue(
      path,
      "advisorToolPolicies",
      "a JSON object with non-empty tool names and full, summary, or exclude values"
    );
  }
  if (
    config.gateFailureMode !== undefined &&
    !isValidGateFailureMode(config.gateFailureMode)
  ) {
    invalidConfigValue(path, "gateFailureMode", GATE_FAILURE_MODES.join(", "));
  }
  if (
    config.advisorGitContext !== undefined &&
    !isValidGitContextLevel(config.advisorGitContext)
  ) {
    invalidConfigValue(
      path,
      "advisorGitContext",
      GIT_CONTEXT_LEVELS.join(", ")
    );
  }
  return true;
};
