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
  advisorSessionSummary?: boolean;
  advisorToolResultMaxBytes?: number;
  advisorToolResultMaxLines?: number;
  contextMaxChars?: number;
  executor?: string;
  executorEffort?: string;
  gateFailureMode?: GateFailureMode;
}

const CONFIG_KEYS = new Set(
  Object.keys({
    advisor: true,
    advisorAutoLoopGate: true,
    advisorBlockOnBlocked: true,
    advisorCollapseResponses: true,
    advisorCompletionGate: true,
    advisorCustomInvocation: true,
    advisorEffort: true,
    advisorFailureGate: true,
    advisorHerdrIntegration: true,
    advisorLoopThreshold: true,
    advisorMaxCallsPerSession: true,
    advisorPlanGate: true,
    advisorSessionSummary: true,
    advisorToolResultMaxBytes: true,
    advisorToolResultMaxLines: true,
    contextMaxChars: true,
    executor: true,
    executorEffort: true,
    gateFailureMode: true,
  })
);

export const validateConfig = (
  value: unknown,
  path = "advisor.json"
): value is AdvisorConfig => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      `Invalid advisor configuration at ${path}: expected a JSON object.`
    );
  }
  const config = value as Record<string, unknown>;
  const unknown = Object.keys(config).filter((key) => !CONFIG_KEYS.has(key));
  if (unknown.length) {
    throw new TypeError(
      `Invalid advisor configuration at ${path}: unknown key(s) ${unknown.map((key) => JSON.stringify(key)).join(", ")}. Remove them or upgrade pi-advisor.`
    );
  }
  const invalid = (key: string, accepted: string) => {
    throw new TypeError(
      `Invalid advisor configuration at ${path}, key ${JSON.stringify(key)}: expected ${accepted}.`
    );
  };
  if (config.executor !== undefined && typeof config.executor !== "string") {
    invalid("executor", "a provider/model string");
  }
  if (config.advisor !== undefined && typeof config.advisor !== "string") {
    invalid("advisor", "a provider/model string");
  }
  if (
    config.executorEffort !== undefined &&
    typeof config.executorEffort !== "string"
  ) {
    invalid("executorEffort", "a string");
  }
  if (
    config.advisorEffort !== undefined &&
    typeof config.advisorEffort !== "string"
  ) {
    invalid("advisorEffort", "a string");
  }
  if (
    config.contextMaxChars !== undefined &&
    !isValidContextMaxChars(config.contextMaxChars)
  ) {
    invalid(
      "contextMaxChars",
      `a safe integer from 0 through ${MAX_CONTEXT_MAX_CHARS}`
    );
  }
  for (const key of [
    "advisorPlanGate",
    "advisorFailureGate",
    "advisorCompletionGate",
    "advisorCollapseResponses",
    "advisorBlockOnBlocked",
    "advisorAutoLoopGate",
    "advisorSessionSummary",
    "advisorHerdrIntegration",
  ]) {
    if (config[key] !== undefined && typeof config[key] !== "boolean") {
      invalid(key, "true or false");
    }
  }
  if (
    config.advisorCustomInvocation !== undefined &&
    typeof config.advisorCustomInvocation !== "string"
  ) {
    invalid("advisorCustomInvocation", "a string");
  }
  if (
    config.advisorLoopThreshold !== undefined &&
    !isValidLoopThreshold(config.advisorLoopThreshold)
  ) {
    invalid("advisorLoopThreshold", "a safe integer of at least 2");
  }
  if (
    config.advisorMaxCallsPerSession !== undefined &&
    !isValidMaxCallsPerSession(config.advisorMaxCallsPerSession)
  ) {
    invalid("advisorMaxCallsPerSession", "a non-negative safe integer");
  }
  if (
    config.gateFailureMode !== undefined &&
    !isValidGateFailureMode(config.gateFailureMode)
  ) {
    invalid("gateFailureMode", GATE_FAILURE_MODES.join(", "));
  }
  if (
    config.advisorToolResultMaxLines !== undefined &&
    !isValidToolResultMaxLines(config.advisorToolResultMaxLines)
  ) {
    invalid("advisorToolResultMaxLines", "a non-negative safe integer");
  }
  if (
    config.advisorToolResultMaxBytes !== undefined &&
    !isValidToolResultMaxBytes(config.advisorToolResultMaxBytes)
  ) {
    invalid("advisorToolResultMaxBytes", "a non-negative safe integer");
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
};

export const loadConfig = (ctx: ExtensionContext) => {
  resetDefaults();
  for (const path of configPaths(ctx)) {
    if (!(path && existsSync(path))) {
      continue;
    }
    let config: AdvisorConfig;
    try {
      config = JSON.parse(readFileSync(path, "utf8")) as AdvisorConfig;
      validateConfig(config, path);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (config.executor) {
      executorRef = config.executor;
    }
    if (config.advisor) {
      advisorRef = config.advisor;
    }
    if (config.executorEffort) {
      executorEffortRef = config.executorEffort;
    }
    if (config.advisorEffort) {
      advisorEffortRef = config.advisorEffort;
    }
    if (config.contextMaxChars !== undefined) {
      contextMaxCharsRef = config.contextMaxChars;
    }
    if (config.advisorPlanGate !== undefined) {
      advisorPlanGateRef = config.advisorPlanGate;
    }
    if (config.advisorFailureGate !== undefined) {
      advisorFailureGateRef = config.advisorFailureGate;
    }
    if (config.advisorCompletionGate !== undefined) {
      advisorCompletionGateRef = config.advisorCompletionGate;
    }
    if (config.advisorCustomInvocation !== undefined) {
      advisorCustomInvocationRef = config.advisorCustomInvocation || undefined;
    }
    if (config.advisorCollapseResponses !== undefined) {
      advisorCollapseResponsesRef = config.advisorCollapseResponses;
    }
    if (config.advisorBlockOnBlocked !== undefined) {
      advisorBlockOnBlockedRef = config.advisorBlockOnBlocked;
    }
    if (config.advisorAutoLoopGate !== undefined) {
      advisorAutoLoopGateRef = config.advisorAutoLoopGate;
    }
    if (config.advisorLoopThreshold !== undefined) {
      advisorLoopThresholdRef = config.advisorLoopThreshold;
    }
    if (config.advisorMaxCallsPerSession !== undefined) {
      advisorMaxCallsPerSessionRef = config.advisorMaxCallsPerSession;
    }
    if (config.advisorSessionSummary !== undefined) {
      advisorSessionSummaryRef = config.advisorSessionSummary;
    }
    if (config.gateFailureMode !== undefined) {
      advisorFailureModeRef = config.gateFailureMode;
    }
    if (config.advisorHerdrIntegration !== undefined) {
      advisorHerdrIntegrationRef = config.advisorHerdrIntegration;
    }
    if (config.advisorToolResultMaxLines !== undefined) {
      advisorToolResultMaxLinesRef = config.advisorToolResultMaxLines;
    }
    if (config.advisorToolResultMaxBytes !== undefined) {
      advisorToolResultMaxBytesRef = config.advisorToolResultMaxBytes;
    }
    return path;
  }
  return null;
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
    advisorSessionSummary: advisorSessionSummaryRef,
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
  for (const token of args.trim().split(/\s+/).filter(Boolean)) {
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
