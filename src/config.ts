import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";

export const FALLBACK_EXECUTOR = "aikeys/claude-sonnet-5";
export const FALLBACK_ADVISOR = "aikeys/claude-fable-5";
export const DEFAULT_CONTEXT_MAX_CHARS = 15_000;
// MAX_SAFE_INTEGER represents the complete reconstructed branch (the ALL preset).
export const MAX_CONTEXT_MAX_CHARS = Number.MAX_SAFE_INTEGER;

export let executorRef = FALLBACK_EXECUTOR;
export let advisorRef = FALLBACK_ADVISOR;
export let executorEffortRef: string | undefined = undefined;
export let advisorEffortRef: string | undefined = undefined;
export let contextMaxCharsRef = DEFAULT_CONTEXT_MAX_CHARS;
export let advisorPlanGateRef = true;
export let advisorFailureGateRef = true;
export let advisorCompletionGateRef = true;
export let advisorCustomInvocationRef: string | undefined = undefined;
export let advisorCollapseResponsesRef = false;
export let advisorBlockOnBlockedRef = true;
export let advisorAutoLoopGateRef = true;
export let advisorLoopThresholdRef = 3;
export let advisorMaxCallsPerSessionRef: number | undefined = undefined;
export let advisorSessionSummaryRef = true;

export const setExecutorRef = (ref: string) => { executorRef = ref; };
export const setAdvisorRef = (ref: string) => { advisorRef = ref; };
export const setExecutorEffortRef = (effort: string | undefined) => { executorEffortRef = effort; };
export const setAdvisorEffortRef = (effort: string | undefined) => { advisorEffortRef = effort; };
export const isValidContextMaxChars = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_CONTEXT_MAX_CHARS;
export const setContextMaxCharsRef = (value: number) => { contextMaxCharsRef = value; };
export const setAdvisorPlanGateRef = (enabled: boolean) => { advisorPlanGateRef = enabled; };
export const setAdvisorFailureGateRef = (enabled: boolean) => { advisorFailureGateRef = enabled; };
export const setAdvisorCompletionGateRef = (enabled: boolean) => { advisorCompletionGateRef = enabled; };
export const setAdvisorCustomInvocationRef = (rule: string | undefined) => { advisorCustomInvocationRef = rule?.trim() || undefined; };
export const setAdvisorCollapseResponsesRef = (enabled: boolean) => { advisorCollapseResponsesRef = enabled; };
export const setAdvisorBlockOnBlockedRef = (enabled: boolean) => { advisorBlockOnBlockedRef = enabled; };
export const setAdvisorAutoLoopGateRef = (enabled: boolean) => { advisorAutoLoopGateRef = enabled; };
export const isValidLoopThreshold = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 2;
export const setAdvisorLoopThresholdRef = (value: number) => { advisorLoopThresholdRef = value; };
export const isValidMaxCallsPerSession = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const setAdvisorMaxCallsPerSessionRef = (value: number | undefined) => { advisorMaxCallsPerSessionRef = value; };
export const setAdvisorSessionSummaryRef = (enabled: boolean) => { advisorSessionSummaryRef = enabled; };

export const splitRef = (ref: string): [string, string] => {
  const i = ref.indexOf("/");
  return i === -1 ? ["aikeys", ref] : [ref.slice(0, i), ref.slice(i + 1)];
};

export const configPaths = (ctx: ExtensionContext) => [
  ctx.isProjectTrusted() ? join(ctx.cwd, CONFIG_DIR_NAME, "advisor.json") : null,
  join(getAgentDir(), "advisor.json"),
];

type AdvisorConfig = {
  executor?: string;
  advisor?: string;
  executorEffort?: string;
  advisorEffort?: string;
  contextMaxChars?: number;
  advisorPlanGate?: boolean;
  advisorFailureGate?: boolean;
  advisorCompletionGate?: boolean;
  advisorCustomInvocation?: string;
  advisorCollapseResponses?: boolean;
  advisorBlockOnBlocked?: boolean;
  advisorAutoLoopGate?: boolean;
  advisorLoopThreshold?: number;
  advisorMaxCallsPerSession?: number;
  advisorSessionSummary?: boolean;
};

const isValidConfig = (value: unknown): value is AdvisorConfig => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return (config.executor === undefined || typeof config.executor === "string")
    && (config.advisor === undefined || typeof config.advisor === "string")
    && (config.executorEffort === undefined || typeof config.executorEffort === "string")
    && (config.advisorEffort === undefined || typeof config.advisorEffort === "string")
    && (config.contextMaxChars === undefined || isValidContextMaxChars(config.contextMaxChars))
    && (config.advisorPlanGate === undefined || typeof config.advisorPlanGate === "boolean")
    && (config.advisorFailureGate === undefined || typeof config.advisorFailureGate === "boolean")
    && (config.advisorCompletionGate === undefined || typeof config.advisorCompletionGate === "boolean")
    && (config.advisorCustomInvocation === undefined || typeof config.advisorCustomInvocation === "string")
    && (config.advisorCollapseResponses === undefined || typeof config.advisorCollapseResponses === "boolean")
    && (config.advisorBlockOnBlocked === undefined || typeof config.advisorBlockOnBlocked === "boolean")
    && (config.advisorAutoLoopGate === undefined || typeof config.advisorAutoLoopGate === "boolean")
    && (config.advisorLoopThreshold === undefined || isValidLoopThreshold(config.advisorLoopThreshold))
    && (config.advisorMaxCallsPerSession === undefined || isValidMaxCallsPerSession(config.advisorMaxCallsPerSession))
    && (config.advisorSessionSummary === undefined || typeof config.advisorSessionSummary === "boolean");
};

export const loadConfig = (ctx: ExtensionContext) => {
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
  for (const path of configPaths(ctx)) {
    if (!path || !existsSync(path)) continue;
    try {
      const config = JSON.parse(readFileSync(path, "utf8"));
      if (!isValidConfig(config)) throw new TypeError("Invalid advisor configuration");
      if (config.executor) executorRef = config.executor;
      if (config.advisor) advisorRef = config.advisor;
      if (config.executorEffort) executorEffortRef = config.executorEffort;
      if (config.advisorEffort) advisorEffortRef = config.advisorEffort;
      if (isValidContextMaxChars(config.contextMaxChars)) contextMaxCharsRef = config.contextMaxChars;
      if (typeof config.advisorPlanGate === "boolean") advisorPlanGateRef = config.advisorPlanGate;
      if (typeof config.advisorFailureGate === "boolean") advisorFailureGateRef = config.advisorFailureGate;
      if (typeof config.advisorCompletionGate === "boolean") advisorCompletionGateRef = config.advisorCompletionGate;
      if (typeof config.advisorCustomInvocation === "string") advisorCustomInvocationRef = config.advisorCustomInvocation || undefined;
      if (typeof config.advisorCollapseResponses === "boolean") advisorCollapseResponsesRef = config.advisorCollapseResponses;
      if (typeof config.advisorBlockOnBlocked === "boolean") advisorBlockOnBlockedRef = config.advisorBlockOnBlocked;
      if (typeof config.advisorAutoLoopGate === "boolean") advisorAutoLoopGateRef = config.advisorAutoLoopGate;
      if (isValidLoopThreshold(config.advisorLoopThreshold)) advisorLoopThresholdRef = config.advisorLoopThreshold;
      if (isValidMaxCallsPerSession(config.advisorMaxCallsPerSession)) advisorMaxCallsPerSessionRef = config.advisorMaxCallsPerSession;
      if (typeof config.advisorSessionSummary === "boolean") advisorSessionSummaryRef = config.advisorSessionSummary;
      return path;
    } catch {
      // Ignore malformed config and keep looking for a valid fallback.
    }
  }
  return null;
};

export const saveConfig = (ctx: ExtensionContext) => {
  const project = join(ctx.cwd, CONFIG_DIR_NAME, "advisor.json");
  const path = ctx.isProjectTrusted() && existsSync(project) ? project : join(getAgentDir(), "advisor.json");
  // Preserve settings owned by future versions or other tools that share this file.
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed as Record<string, unknown>;
  } catch {
    // A missing or malformed file is safely replaced with the current settings.
  }
  const data = {
    ...existing,
    executor: executorRef,
    advisor: advisorRef,
    executorEffort: executorEffortRef,
    advisorEffort: advisorEffortRef,
    contextMaxChars: contextMaxCharsRef,
    advisorPlanGate: advisorPlanGateRef,
    advisorFailureGate: advisorFailureGateRef,
    advisorCompletionGate: advisorCompletionGateRef,
    advisorCustomInvocation: advisorCustomInvocationRef,
    advisorCollapseResponses: advisorCollapseResponsesRef,
    advisorBlockOnBlocked: advisorBlockOnBlockedRef,
    advisorAutoLoopGate: advisorAutoLoopGateRef,
    advisorLoopThreshold: advisorLoopThresholdRef,
    ...(advisorMaxCallsPerSessionRef === undefined ? {} : { advisorMaxCallsPerSession: advisorMaxCallsPerSessionRef }),
    advisorSessionSummary: advisorSessionSummaryRef,
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
    if (key === "executor" && value) nextExecutor = value;
    if (key === "advisor" && value) nextAdvisor = value;
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
  return undefined;
};
