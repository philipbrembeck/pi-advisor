import { GIT_CONTEXT_LEVELS, isValidGitContextLevel } from "../git.ts";
import {
  advisorAutoLoopGateRef,
  advisorBlockOnBlockedRef,
  advisorCollapseResponsesRef,
  advisorCompletionGateRef,
  advisorCustomInvocationRef,
  advisorEffortRef,
  advisorFailureGateRef,
  advisorFailureModeRef,
  advisorGitContextMaxCharsRef,
  advisorGitContextRef,
  advisorHerdrIntegrationRef,
  advisorLoopThresholdRef,
  advisorMaxCallsPerSessionRef,
  advisorOutcomeLoggingRef,
  advisorPlanGateRef,
  advisorRedactSecretsRef,
  advisorRef,
  advisorScoutEnabledRef,
  advisorSessionSummaryRef,
  advisorToolPoliciesRef,
  advisorToolResultMaxBytesRef,
  advisorToolResultMaxLinesRef,
  advisorTrackedFileContentRef,
  advisorUntrackedContentRef,
  alwaysOnRef,
  contextMaxCharsRef,
  executorEffortRef,
  executorRef,
  showUsageDetailsRef,
  showUsageFooterRef,
  simpleModeRef,
} from "./state.ts";
import {
  ADVISOR_TOOL_POLICIES,
  type AdvisorConfig,
  GATE_FAILURE_MODES,
  MAX_CONTEXT_MAX_CHARS,
} from "./types.ts";

/** An empty ref means no model has been selected yet. */
const configuredModelRef = (value: string | undefined): string | undefined =>
  value?.trim() || undefined;

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

const nonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const isValidContextMaxChars = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_CONTEXT_MAX_CHARS;

export const isValidLoopThreshold = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 2;

export const isValidMaxCallsPerSession = (value: unknown): value is number =>
  nonNegativeSafeInteger(value);

export const isValidGateFailureMode = (
  value: unknown
): value is (typeof GATE_FAILURE_MODES)[number] =>
  typeof value === "string" &&
  GATE_FAILURE_MODES.includes(value as (typeof GATE_FAILURE_MODES)[number]);

export const isValidToolResultMaxLines = (value: unknown): value is number =>
  nonNegativeSafeInteger(value);

export const isValidToolResultMaxBytes = (value: unknown): value is number =>
  nonNegativeSafeInteger(value);

/** One declarative entry per AdvisorConfig key: JSON type, persistence, and
 * the live runtime value behind it. Validation and storage derive from this
 * table; adding a setting means adding exactly one entry here. */
export interface ConfigKeySchema {
  /** Human-readable accepted-value phrase for error messages. */
  accepted: string;
  /** Live runtime value captured by saveConfig. */
  current: () => unknown;
  /** Included in the state captured and diffed by saveConfig. */
  persisted: boolean;
  /** JSON value type used for the base type check. */
  type: "string" | "boolean" | "number" | "enum" | "object";
  /** Type beyond the JSON type, for enum and object keys. */
  validate?: (value: unknown) => boolean;
}

export const CONFIG_SCHEMA = {
  advisor: {
    accepted: "a provider/model string",
    current: () => configuredModelRef(advisorRef),
    persisted: true,
    type: "string",
  },
  advisorAutoLoopGate: {
    accepted: "true or false",
    current: () => advisorAutoLoopGateRef,
    persisted: true,
    type: "boolean",
  },
  advisorBlockOnBlocked: {
    accepted: "true or false",
    current: () => advisorBlockOnBlockedRef,
    persisted: true,
    type: "boolean",
  },
  advisorCollapseResponses: {
    accepted: "true or false",
    current: () => advisorCollapseResponsesRef,
    persisted: true,
    type: "boolean",
  },
  advisorCompletionGate: {
    accepted: "true or false",
    current: () => advisorCompletionGateRef,
    persisted: true,
    type: "boolean",
  },
  advisorCustomInvocation: {
    accepted: "a string",
    current: () => advisorCustomInvocationRef,
    persisted: true,
    type: "string",
  },
  advisorEffort: {
    accepted: "a string",
    current: () => advisorEffortRef,
    persisted: true,
    type: "string",
  },
  advisorFailureGate: {
    accepted: "true or false",
    current: () => advisorFailureGateRef,
    persisted: true,
    type: "boolean",
  },
  advisorGitContext: {
    accepted: GIT_CONTEXT_LEVELS.join(", "),
    current: () => advisorGitContextRef,
    persisted: true,
    type: "enum",
    validate: isValidGitContextLevel,
  },
  advisorGitContextMaxChars: {
    accepted: "a non-negative safe integer",
    current: () => advisorGitContextMaxCharsRef,
    persisted: true,
    type: "number",
    validate: nonNegativeSafeInteger,
  },
  advisorHerdrIntegration: {
    accepted: "true or false",
    current: () => advisorHerdrIntegrationRef,
    persisted: true,
    type: "boolean",
  },
  advisorLoopThreshold: {
    accepted: "a safe integer of at least 2",
    current: () => advisorLoopThresholdRef,
    persisted: true,
    type: "number",
    validate: isValidLoopThreshold,
  },
  advisorMaxCallsPerSession: {
    accepted: "a non-negative safe integer",
    current: () => advisorMaxCallsPerSessionRef,
    persisted: true,
    type: "number",
    validate: isValidMaxCallsPerSession,
  },
  advisorOutcomeLogging: {
    accepted: "true or false",
    current: () => advisorOutcomeLoggingRef,
    persisted: false,
    type: "boolean",
  },
  advisorPlanGate: {
    accepted: "true or false",
    current: () => advisorPlanGateRef,
    persisted: true,
    type: "boolean",
  },
  advisorRedactSecrets: {
    accepted: "true or false",
    current: () => advisorRedactSecretsRef,
    persisted: true,
    type: "boolean",
  },
  advisorScoutEnabled: {
    accepted: "true or false",
    current: () => advisorScoutEnabledRef,
    persisted: true,
    type: "boolean",
  },
  advisorSessionSummary: {
    accepted: "true or false",
    current: () => advisorSessionSummaryRef,
    persisted: true,
    type: "boolean",
  },
  advisorToolPolicies: {
    accepted:
      "a JSON object with non-empty tool names and full, summary, or exclude values",
    current: () => ({ ...advisorToolPoliciesRef }),
    persisted: true,
    type: "object",
    validate: isValidAdvisorToolPolicies,
  },
  advisorToolResultMaxBytes: {
    accepted: "a non-negative safe integer",
    current: () => advisorToolResultMaxBytesRef,
    persisted: true,
    type: "number",
    validate: isValidToolResultMaxBytes,
  },
  advisorToolResultMaxLines: {
    accepted: "a non-negative safe integer",
    current: () => advisorToolResultMaxLinesRef,
    persisted: true,
    type: "number",
    validate: isValidToolResultMaxLines,
  },
  advisorTrackedFileContent: {
    accepted: "true or false",
    current: () => advisorTrackedFileContentRef,
    persisted: true,
    type: "boolean",
  },
  advisorUntrackedContent: {
    accepted: "true or false",
    current: () => advisorUntrackedContentRef,
    persisted: true,
    type: "boolean",
  },
  alwaysOn: {
    accepted: "true or false",
    current: () => alwaysOnRef,
    persisted: true,
    type: "boolean",
  },
  contextMaxChars: {
    accepted: `a safe integer from 0 through ${MAX_CONTEXT_MAX_CHARS}`,
    current: () => contextMaxCharsRef,
    persisted: true,
    type: "number",
    validate: isValidContextMaxChars,
  },
  executor: {
    accepted: "a provider/model string",
    current: () => configuredModelRef(executorRef),
    persisted: true,
    type: "string",
  },
  executorEffort: {
    accepted: "a string",
    current: () => executorEffortRef,
    persisted: true,
    type: "string",
  },
  gateFailureMode: {
    accepted: GATE_FAILURE_MODES.join(", "),
    current: () => advisorFailureModeRef,
    persisted: true,
    type: "enum",
    validate: isValidGateFailureMode,
  },
  showUsageDetails: {
    accepted: "true or false",
    current: () => showUsageDetailsRef,
    persisted: true,
    type: "boolean",
  },
  showUsageFooter: {
    accepted: "true or false",
    current: () => showUsageFooterRef,
    persisted: true,
    type: "boolean",
  },
  simpleMode: {
    accepted: "true or false",
    current: () => simpleModeRef,
    persisted: true,
    type: "boolean",
  },
} as const satisfies Record<keyof AdvisorConfig, ConfigKeySchema>;

export type ConfigKey = keyof typeof CONFIG_SCHEMA;

/** Keys saveConfig captures, diffs, and writes to advisor.json. */
export type PersistedConfigKey = {
  [Key in ConfigKey]: (typeof CONFIG_SCHEMA)[Key]["persisted"] extends true
    ? Key
    : never;
}[ConfigKey];

export const SAVED_CONFIG_KEYS = (
  Object.keys(CONFIG_SCHEMA) as ConfigKey[]
).filter(
  (key) => CONFIG_SCHEMA[key].persisted
) as readonly PersistedConfigKey[];

/** Widened per-key view for consumers that index by dynamic key. */
const SCHEMA_BY_KEY: Record<ConfigKey, ConfigKeySchema> = CONFIG_SCHEMA;

export { configuredModelRef, SCHEMA_BY_KEY };
