import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

export const FALLBACK_EXECUTOR = "aikeys/claude-sonnet-5";
export const FALLBACK_ADVISOR = "aikeys/claude-fable-5";
export const DEFAULT_CONTEXT_MAX_CHARS = 15_000;
export const MAX_CONTEXT_MAX_CHARS = Number.MAX_SAFE_INTEGER;
export const DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES = DEFAULT_MAX_LINES;
export const DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES = DEFAULT_MAX_BYTES;
export type AdvisorToolPolicy = "full" | "summary" | "exclude";
export type AdvisorToolPolicies = Record<string, AdvisorToolPolicy>;
export const ADVISOR_TOOL_POLICIES: AdvisorToolPolicy[] = [
  "full",
  "summary",
  "exclude",
];
export type GateFailureMode =
  | "block-session"
  | "block-tool"
  | "warn-and-continue";
export const GATE_FAILURE_MODES: GateFailureMode[] = [
  "block-session",
  "block-tool",
  "warn-and-continue",
];

export let executorRef = FALLBACK_EXECUTOR;
export let advisorRef = FALLBACK_ADVISOR;
export let executorEffortRef: string | undefined;
export let advisorEffortRef: string | undefined;
export let contextMaxCharsRef = DEFAULT_CONTEXT_MAX_CHARS;
export let advisorPlanGateRef = true;
export let advisorFailureGateRef = true;
export let advisorCompletionGateRef = true;
export let advisorCustomInvocationRef: string | undefined;
export let advisorCollapseResponsesRef = false;
export let advisorBlockOnBlockedRef = true;
export let advisorAutoLoopGateRef = true;
export let advisorLoopThresholdRef = 3;
export let advisorMaxCallsPerSessionRef: number | undefined;
export let advisorSessionSummaryRef = true;
export let advisorFailureModeRef: GateFailureMode = "block-session";
export let advisorHerdrIntegrationRef = true;
export let advisorToolResultMaxLinesRef = DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES;
export let advisorToolResultMaxBytesRef = DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES;
export let advisorRedactSecretsRef = false;
export let advisorToolPoliciesRef: AdvisorToolPolicies = {};

export const setExecutorRef = (ref: string) => {
  executorRef = ref;
};
export const setAdvisorRef = (ref: string) => {
  advisorRef = ref;
};
export const setExecutorEffortRef = (effort: string | undefined) => {
  executorEffortRef = effort;
};
export const setAdvisorEffortRef = (effort: string | undefined) => {
  advisorEffortRef = effort;
};
export const isValidContextMaxChars = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_CONTEXT_MAX_CHARS;
export const setContextMaxCharsRef = (value: number) => {
  contextMaxCharsRef = value;
};
export const setAdvisorPlanGateRef = (enabled: boolean) => {
  advisorPlanGateRef = enabled;
};
export const setAdvisorFailureGateRef = (enabled: boolean) => {
  advisorFailureGateRef = enabled;
};
export const setAdvisorCompletionGateRef = (enabled: boolean) => {
  advisorCompletionGateRef = enabled;
};
export const setAdvisorCustomInvocationRef = (rule: string | undefined) => {
  advisorCustomInvocationRef = rule?.trim() || undefined;
};
export const setAdvisorCollapseResponsesRef = (enabled: boolean) => {
  advisorCollapseResponsesRef = enabled;
};
export const setAdvisorBlockOnBlockedRef = (enabled: boolean) => {
  advisorBlockOnBlockedRef = enabled;
};
export const setAdvisorAutoLoopGateRef = (enabled: boolean) => {
  advisorAutoLoopGateRef = enabled;
};
export const isValidLoopThreshold = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 2;
export const setAdvisorLoopThresholdRef = (value: number) => {
  advisorLoopThresholdRef = value;
};
export const isValidMaxCallsPerSession = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const setAdvisorMaxCallsPerSessionRef = (value: number | undefined) => {
  advisorMaxCallsPerSessionRef = value;
};
export const setAdvisorSessionSummaryRef = (enabled: boolean) => {
  advisorSessionSummaryRef = enabled;
};
export const isValidGateFailureMode = (
  value: unknown
): value is GateFailureMode =>
  typeof value === "string" &&
  GATE_FAILURE_MODES.includes(value as GateFailureMode);
export const setAdvisorFailureModeRef = (value: GateFailureMode) => {
  advisorFailureModeRef = value;
};
export const setAdvisorHerdrIntegrationRef = (enabled: boolean) => {
  advisorHerdrIntegrationRef = enabled;
};
export const isValidToolResultMaxLines = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const isValidToolResultMaxBytes = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const setAdvisorToolResultMaxLinesRef = (value: number) => {
  advisorToolResultMaxLinesRef = value;
};
export const setAdvisorToolResultMaxBytesRef = (value: number) => {
  advisorToolResultMaxBytesRef = value;
};
export const setAdvisorRedactSecretsRef = (enabled: boolean) => {
  advisorRedactSecretsRef = enabled;
};
export const setAdvisorToolPoliciesRef = (policies: AdvisorToolPolicies) => {
  advisorToolPoliciesRef = { ...policies };
};

/**
 * Returns the current live settings state. Use this at UI boundaries instead of
 * imported mutable bindings, which can be snapshotted by extension loaders.
 */
export const getAdvisorSettings = () => ({
  autoLoopGate: advisorAutoLoopGateRef,
  blockOnBlocked: advisorBlockOnBlockedRef,
  collapseResponses: advisorCollapseResponsesRef,
  completionGate: advisorCompletionGateRef,
  contextMaxChars: contextMaxCharsRef,
  customRule: advisorCustomInvocationRef,
  effort: advisorEffortRef,
  failureGate: advisorFailureGateRef,
  failureMode: advisorFailureModeRef,
  herdrIntegration: advisorHerdrIntegrationRef,
  loopThreshold: advisorLoopThresholdRef,
  maxCallsPerSession: advisorMaxCallsPerSessionRef,
  planGate: advisorPlanGateRef,
  redactSecrets: advisorRedactSecretsRef,
  sessionSummary: advisorSessionSummaryRef,
  toolPolicies: { ...advisorToolPoliciesRef },
  toolResultMaxBytes: advisorToolResultMaxBytesRef,
  toolResultMaxLines: advisorToolResultMaxLinesRef,
});

export const splitRef = (ref: string): [string, string] => {
  const i = ref.indexOf("/");
  return i === -1 ? ["aikeys", ref] : [ref.slice(0, i), ref.slice(i + 1)];
};

export const configPaths = (ctx: ExtensionContext) => [
  ctx.isProjectTrusted()
    ? join(ctx.cwd, CONFIG_DIR_NAME, "advisor.json")
    : null,
  join(getAgentDir(), "advisor.json"),
];

export interface AdvisorConfig {
  advisor?: string;
  advisorAutoLoopGate?: boolean;
  advisorBlockOnBlocked?: boolean;
  advisorCollapseResponses?: boolean;
  advisorCompletionGate?: boolean;
  advisorCustomInvocation?: string;
  advisorEffort?: string;
  advisorFailureGate?: boolean;
  advisorHerdrIntegration?: boolean;
  advisorLoopThreshold?: number;
  advisorMaxCallsPerSession?: number;
  advisorPlanGate?: boolean;
  advisorRedactSecrets?: boolean;
  advisorSessionSummary?: boolean;
  advisorToolPolicies?: AdvisorToolPolicies;
  advisorToolResultMaxBytes?: number;
  advisorToolResultMaxLines?: number;
  contextMaxChars?: number;
  executor?: string;
  executorEffort?: string;
  gateFailureMode?: GateFailureMode;
}

const CONFIG_KEYS = new Set<keyof AdvisorConfig>([
  "advisor",
  "advisorAutoLoopGate",
  "advisorBlockOnBlocked",
  "advisorCollapseResponses",
  "advisorCompletionGate",
  "advisorCustomInvocation",
  "advisorEffort",
  "advisorFailureGate",
  "advisorHerdrIntegration",
  "advisorLoopThreshold",
  "advisorMaxCallsPerSession",
  "advisorPlanGate",
  "advisorSessionSummary",
  "advisorToolResultMaxBytes",
  "advisorToolResultMaxLines",
  "advisorRedactSecrets",
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
  "advisorHerdrIntegration",
  "advisorRedactSecrets",
] as const;
const STRING_CONFIG_KEYS = [
  "executor",
  "advisor",
  "executorEffort",
  "advisorEffort",
  "advisorCustomInvocation",
] as const;
const ARGUMENT_WHITESPACE = /\s+/;

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

const validateKnownKeys = (config: ConfigRecord, path: string) => {
  const unknownKeys = Object.keys(config).filter(
    (key) => !CONFIG_KEYS.has(key as keyof AdvisorConfig)
  );
  if (unknownKeys.length > 0) {
    throw new TypeError(
      `Invalid advisor configuration at ${path}: unknown key(s) ${unknownKeys.map((key) => JSON.stringify(key)).join(", ")}. Remove them or upgrade pi-advisor.`
    );
  }
};

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
): value is AdvisorToolPolicies => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([toolName, policy]) =>
      toolName.trim().length > 0 &&
      typeof policy === "string" &&
      ADVISOR_TOOL_POLICIES.includes(policy as AdvisorToolPolicy)
  );
};

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
  validateKnownKeys(config, path);
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
  return true;
};

const resetDefaults = () => {
  executorRef = FALLBACK_EXECUTOR;
  advisorRef = FALLBACK_ADVISOR;
  executorEffortRef = undefined;
  advisorEffortRef = undefined;
  contextMaxCharsRef = DEFAULT_CONTEXT_MAX_CHARS;
  advisorPlanGateRef = true;
  advisorFailureGateRef = true;
  advisorCompletionGateRef = true;
  advisorCustomInvocationRef = undefined;
  advisorCollapseResponsesRef = false;
  advisorBlockOnBlockedRef = true;
  advisorAutoLoopGateRef = true;
  advisorLoopThresholdRef = 3;
  advisorMaxCallsPerSessionRef = undefined;
  advisorSessionSummaryRef = true;
  advisorFailureModeRef = "block-session";
  advisorHerdrIntegrationRef = true;
  advisorToolResultMaxLinesRef = DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES;
  advisorToolResultMaxBytesRef = DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES;
  advisorRedactSecretsRef = false;
  advisorToolPoliciesRef = {};
};

const applyOptionalConfig = <Key extends keyof AdvisorConfig>(
  config: AdvisorConfig,
  key: Key,
  apply: (value: NonNullable<AdvisorConfig[Key]>) => void
) => {
  const value = config[key];
  if (value !== undefined) {
    apply(value as NonNullable<AdvisorConfig[Key]>);
  }
};

const applyNonEmptyStringConfig = (
  value: string | undefined,
  apply: (value: string) => void
) => {
  if (value) {
    apply(value);
  }
};

const applyConfig = (config: AdvisorConfig) => {
  applyNonEmptyStringConfig(config.executor, setExecutorRef);
  applyNonEmptyStringConfig(config.advisor, setAdvisorRef);
  applyNonEmptyStringConfig(config.executorEffort, setExecutorEffortRef);
  applyNonEmptyStringConfig(config.advisorEffort, setAdvisorEffortRef);
  applyOptionalConfig(config, "contextMaxChars", setContextMaxCharsRef);
  applyOptionalConfig(config, "advisorPlanGate", setAdvisorPlanGateRef);
  applyOptionalConfig(config, "advisorFailureGate", setAdvisorFailureGateRef);
  applyOptionalConfig(
    config,
    "advisorCompletionGate",
    setAdvisorCompletionGateRef
  );
  applyOptionalConfig(
    config,
    "advisorCustomInvocation",
    setAdvisorCustomInvocationRef
  );
  applyOptionalConfig(
    config,
    "advisorCollapseResponses",
    setAdvisorCollapseResponsesRef
  );
  applyOptionalConfig(
    config,
    "advisorBlockOnBlocked",
    setAdvisorBlockOnBlockedRef
  );
  applyOptionalConfig(config, "advisorAutoLoopGate", setAdvisorAutoLoopGateRef);
  applyOptionalConfig(
    config,
    "advisorLoopThreshold",
    setAdvisorLoopThresholdRef
  );
  applyOptionalConfig(
    config,
    "advisorMaxCallsPerSession",
    setAdvisorMaxCallsPerSessionRef
  );
  applyOptionalConfig(
    config,
    "advisorSessionSummary",
    setAdvisorSessionSummaryRef
  );
  applyOptionalConfig(config, "gateFailureMode", setAdvisorFailureModeRef);
  applyOptionalConfig(
    config,
    "advisorHerdrIntegration",
    setAdvisorHerdrIntegrationRef
  );
  applyOptionalConfig(
    config,
    "advisorToolResultMaxLines",
    setAdvisorToolResultMaxLinesRef
  );
  applyOptionalConfig(
    config,
    "advisorToolResultMaxBytes",
    setAdvisorToolResultMaxBytesRef
  );
  applyOptionalConfig(
    config,
    "advisorRedactSecrets",
    setAdvisorRedactSecretsRef
  );
  applyOptionalConfig(config, "advisorToolPolicies", setAdvisorToolPoliciesRef);
};

const readConfig = (path: string): AdvisorConfig => {
  try {
    const config = JSON.parse(readFileSync(path, "utf8"));
    validateConfig(config, path);
    return config;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
};

export const loadConfig = (ctx: ExtensionContext) => {
  resetDefaults();
  const path = configPaths(ctx).find(
    (candidate): candidate is string =>
      candidate !== null && existsSync(candidate)
  );
  if (!path) {
    return null;
  }
  applyConfig(readConfig(path));
  return path;
};

export const saveConfig = (ctx: ExtensionContext) => {
  const project = join(ctx.cwd, CONFIG_DIR_NAME, "advisor.json");
  const path =
    ctx.isProjectTrusted() && existsSync(project)
      ? project
      : join(getAgentDir(), "advisor.json");
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    /* replace a missing or malformed file */
  }
  if (advisorMaxCallsPerSessionRef === undefined) {
    existing.advisorMaxCallsPerSession = undefined;
  }
  const data = {
    ...existing,
    advisor: advisorRef,
    advisorAutoLoopGate: advisorAutoLoopGateRef,
    advisorBlockOnBlocked: advisorBlockOnBlockedRef,
    advisorCollapseResponses: advisorCollapseResponsesRef,
    advisorCompletionGate: advisorCompletionGateRef,
    advisorCustomInvocation: advisorCustomInvocationRef,
    advisorEffort: advisorEffortRef,
    advisorFailureGate: advisorFailureGateRef,
    advisorLoopThreshold: advisorLoopThresholdRef,
    advisorPlanGate: advisorPlanGateRef,
    contextMaxChars: contextMaxCharsRef,
    executor: executorRef,
    executorEffort: executorEffortRef,
    ...(advisorMaxCallsPerSessionRef === undefined
      ? {}
      : { advisorMaxCallsPerSession: advisorMaxCallsPerSessionRef }),
    advisorHerdrIntegration: advisorHerdrIntegrationRef,
    advisorRedactSecrets: advisorRedactSecretsRef,
    advisorSessionSummary: advisorSessionSummaryRef,
    advisorToolPolicies: advisorToolPoliciesRef,
    advisorToolResultMaxBytes: advisorToolResultMaxBytesRef,
    advisorToolResultMaxLines: advisorToolResultMaxLinesRef,
    gateFailureMode: advisorFailureModeRef,
  };
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
};

export const parseArgs = (args: string): string | undefined => {
  let nextExecutor = executorRef;
  let nextAdvisor = advisorRef;
  let nextContextMaxChars = contextMaxCharsRef;
  for (const token of args.trim().split(ARGUMENT_WHITESPACE).filter(Boolean)) {
    const [key, value] = token.split("=");
    if (key === "executor" && value) {
      nextExecutor = value;
    }
    if (key === "advisor" && value) {
      nextAdvisor = value;
    }
    if (key === "contextMaxChars") {
      const parsed = Number(value);
      if (!isValidContextMaxChars(parsed)) {
        return `contextMaxChars must be a non-negative integer no greater than ${MAX_CONTEXT_MAX_CHARS}.`;
      }
      nextContextMaxChars = parsed;
    }
  }
  executorRef = nextExecutor;
  advisorRef = nextAdvisor;
  contextMaxCharsRef = nextContextMaxChars;
};
