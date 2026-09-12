import type { GitContextLevel } from "../git.ts";
import {
  type AdvisorToolPolicies,
  DEFAULT_ADVISOR_GIT_CONTEXT_MAX_CHARS,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES,
  DEFAULT_CONTEXT_MAX_CHARS,
  type GateFailureMode,
} from "./types.ts";

// An empty ref means no model has been selected yet.
export let executorRef = "";
export let advisorRef = "";
let persistedExecutorRef: string | undefined;
let persistedAdvisorRef: string | undefined;
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
export let advisorSessionSummaryRef = false;
export let simpleModeRef = false;
export let alwaysOnRef = false;
export let advisorFailureModeRef: GateFailureMode = "block-session";
export let advisorHerdrIntegrationRef = true;
export let advisorToolResultMaxLinesRef = DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES;
export let advisorToolResultMaxBytesRef = DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES;
export let advisorRedactSecretsRef = false;
export let advisorGitContextRef: GitContextLevel = "summary";
export let advisorGitContextMaxCharsRef = DEFAULT_ADVISOR_GIT_CONTEXT_MAX_CHARS;
export let advisorToolPoliciesRef: AdvisorToolPolicies = {};
export let advisorOutcomeLoggingRef = false;
export let advisorUntrackedContentRef = false;
export let advisorTrackedFileContentRef = false;
export let advisorScoutEnabledRef = false;
export let showUsageDetailsRef = true;
export let showUsageFooterRef = false;

export const setExecutorRef = (ref: string) => {
  executorRef = ref;
};
export const setAdvisorRef = (ref: string) => {
  advisorRef = ref;
};
/** Returns model refs explicitly persisted in the global Advisor config. */
export const getPersistedModelRefs = () => ({
  advisor: persistedAdvisorRef,
  executor: persistedExecutorRef,
});

/** Updates persisted model refs without exposing the mutation in the facade. */
export const setPersistedModelRefs = (
  advisor: string | undefined,
  executor: string | undefined
) => {
  persistedAdvisorRef = advisor;
  persistedExecutorRef = executor;
};

export const setExecutorEffortRef = (effort: string | undefined) => {
  executorEffortRef = effort;
};
export const setAdvisorEffortRef = (effort: string | undefined) => {
  advisorEffortRef = effort;
};
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
export const setAdvisorLoopThresholdRef = (value: number) => {
  advisorLoopThresholdRef = value;
};
export const setAdvisorMaxCallsPerSessionRef = (value: number | undefined) => {
  advisorMaxCallsPerSessionRef = value;
};
export const setAdvisorSessionSummaryRef = (enabled: boolean) => {
  advisorSessionSummaryRef = enabled;
};
export const setSimpleModeRef = (enabled: boolean) => {
  simpleModeRef = enabled;
};
export const setAlwaysOnRef = (enabled: boolean) => {
  alwaysOnRef = enabled;
};
/** Whether advanced Advisor automation is suppressed for this session. */
export const isSimpleMode = () => simpleModeRef;
export const setAdvisorFailureModeRef = (value: GateFailureMode) => {
  advisorFailureModeRef = value;
};
export const setAdvisorHerdrIntegrationRef = (enabled: boolean) => {
  advisorHerdrIntegrationRef = enabled;
};
export const setAdvisorToolResultMaxLinesRef = (value: number) => {
  advisorToolResultMaxLinesRef = value;
};
export const setAdvisorToolResultMaxBytesRef = (value: number) => {
  advisorToolResultMaxBytesRef = value;
};
export const setAdvisorRedactSecretsRef = (enabled: boolean) => {
  advisorRedactSecretsRef = enabled;
};
export const setAdvisorGitContextRef = (level: GitContextLevel) => {
  advisorGitContextRef = level;
};
export const setAdvisorGitContextMaxCharsRef = (value: number) => {
  advisorGitContextMaxCharsRef = value;
};
export const setAdvisorToolPoliciesRef = (policies: AdvisorToolPolicies) => {
  advisorToolPoliciesRef = { ...policies };
};
export const setAdvisorOutcomeLoggingRef = (enabled: boolean) => {
  advisorOutcomeLoggingRef = enabled;
};
export const setAdvisorUntrackedContentRef = (enabled: boolean) => {
  advisorUntrackedContentRef = enabled;
};
export const setAdvisorTrackedFileContentRef = (enabled: boolean) => {
  advisorTrackedFileContentRef = enabled;
};
export const setAdvisorScoutEnabledRef = (enabled: boolean) => {
  advisorScoutEnabledRef = enabled;
};
export const setShowUsageDetailsRef = (enabled: boolean) => {
  showUsageDetailsRef = enabled;
};
export const setShowUsageFooterRef = (enabled: boolean) => {
  showUsageFooterRef = enabled;
};

/**
 * Returns the current live settings state. Use this at UI boundaries instead of
 * imported mutable bindings, which can be snapshotted by extension loaders.
 */
export const getAdvisorSettings = () => ({
  alwaysOn: alwaysOnRef,
  autoLoopGate: advisorAutoLoopGateRef,
  blockOnBlocked: advisorBlockOnBlockedRef,
  collapseResponses: advisorCollapseResponsesRef,
  completionGate: advisorCompletionGateRef,
  contextMaxChars: contextMaxCharsRef,
  customRule: advisorCustomInvocationRef,
  effort: advisorEffortRef,
  failureGate: advisorFailureGateRef,
  failureMode: advisorFailureModeRef,
  gitContext: advisorGitContextRef,
  gitContextMaxChars: advisorGitContextMaxCharsRef,
  herdrIntegration: advisorHerdrIntegrationRef,
  loopThreshold: advisorLoopThresholdRef,
  maxCallsPerSession: advisorMaxCallsPerSessionRef,
  outcomeLogging: advisorOutcomeLoggingRef,
  planGate: advisorPlanGateRef,
  redactSecrets: advisorRedactSecretsRef,
  scoutEnabled: advisorScoutEnabledRef,
  sessionSummary: advisorSessionSummaryRef,
  showUsageDetails: showUsageDetailsRef,
  showUsageFooter: showUsageFooterRef,
  simpleMode: simpleModeRef,
  toolPolicies: { ...advisorToolPoliciesRef },
  toolResultMaxBytes: advisorToolResultMaxBytesRef,
  toolResultMaxLines: advisorToolResultMaxLinesRef,
  trackedFileContent: advisorTrackedFileContentRef,
  untrackedContent: advisorUntrackedContentRef,
});

/** Reads the live session budget at each enforcement boundary. */
export const getAdvisorMaxCallsPerSession = () =>
  getAdvisorSettings().maxCallsPerSession;

export const splitRef = (ref: string): [string, string] => {
  const i = ref.indexOf("/");
  return i === -1 ? ["openai-codex", ref] : [ref.slice(0, i), ref.slice(i + 1)];
};
