import {
  setAdvisorAutoLoopGateRef,
  setAdvisorBlockOnBlockedRef,
  setAdvisorCollapseResponsesRef,
  setAdvisorCompletionGateRef,
  setAdvisorCustomInvocationRef,
  setAdvisorEffortRef,
  setAdvisorFailureGateRef,
  setAdvisorFailureModeRef,
  setAdvisorGitContextMaxCharsRef,
  setAdvisorGitContextRef,
  setAdvisorHerdrIntegrationRef,
  setAdvisorJevDigestMaxCharsRef,
  setAdvisorJevFilterEnabledRef,
  setAdvisorJevFilterNoulMarginRef,
  setAdvisorJevFilterOverrideWindowRef,
  setAdvisorJevFilterSkipConfidenceRef,
  setAdvisorJevModelRef,
  setAdvisorJevPricePerMtokRef,
  setAdvisorJevTimeoutMsRef,
  setAdvisorJevTransportRef,
  setAdvisorJevTurnGateEveryTurnsRef,
  setAdvisorJevTurnGateNoulThresholdRef,
  setAdvisorLoopThresholdRef,
  setAdvisorMaxCallsPerSessionRef,
  setAdvisorModelWhitelistRef,
  setAdvisorOutcomeLoggingRef,
  setAdvisorPlanGateRef,
  setAdvisorRedactSecretsRef,
  setAdvisorRef,
  setAdvisorScoutEnabledRef,
  setAdvisorSessionSummaryRef,
  setAdvisorToolPoliciesRef,
  setAdvisorToolResultMaxBytesRef,
  setAdvisorToolResultMaxLinesRef,
  setAdvisorTrackedFileContentRef,
  setAdvisorUntrackedContentRef,
  setAlwaysOnRef,
  setContextMaxCharsRef,
  setExecutorEffortRef,
  setExecutorRef,
  setPersistedModelRefs,
  setShowUsageDetailsRef,
  setShowUsageFooterRef,
  setSimpleModeRef,
} from "./state.ts";
import type { AdvisorConfig } from "./types.ts";
import {
  DEFAULT_ADVISOR_GIT_CONTEXT_MAX_CHARS,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES,
  DEFAULT_CONTEXT_MAX_CHARS,
  DEFAULT_JEV_DIGEST_MAX_CHARS,
  DEFAULT_JEV_FILTER_NOUL_MARGIN,
  DEFAULT_JEV_FILTER_OVERRIDE_WINDOW,
  DEFAULT_JEV_FILTER_SKIP_CONFIDENCE,
  DEFAULT_JEV_MODEL,
  DEFAULT_JEV_PRICE_PER_MTOK,
  DEFAULT_JEV_TIMEOUT_MS,
  DEFAULT_JEV_TRANSPORT,
  DEFAULT_JEV_TURN_GATE_EVERY_TURNS,
  DEFAULT_JEV_TURN_GATE_NOUL_THRESHOLD,
} from "./types.ts";

export const resetDefaults = () => {
  setExecutorRef("");
  setAdvisorRef("");
  setPersistedModelRefs(undefined, undefined);
  setExecutorEffortRef(undefined);
  setAdvisorEffortRef(undefined);
  setContextMaxCharsRef(DEFAULT_CONTEXT_MAX_CHARS);
  setAdvisorPlanGateRef(true);
  setAdvisorFailureGateRef(true);
  setAdvisorCompletionGateRef(true);
  setAdvisorCustomInvocationRef(undefined);
  setAdvisorCollapseResponsesRef(false);
  setAdvisorBlockOnBlockedRef(true);
  setAdvisorAutoLoopGateRef(true);
  setAdvisorLoopThresholdRef(3);
  setAdvisorMaxCallsPerSessionRef(undefined);
  setAdvisorModelWhitelistRef([]);
  setAdvisorSessionSummaryRef(false);
  setSimpleModeRef(false);
  setAlwaysOnRef(false);
  setAdvisorFailureModeRef("block-session");
  setAdvisorHerdrIntegrationRef(true);
  setAdvisorJevModelRef(DEFAULT_JEV_MODEL);
  setAdvisorJevFilterEnabledRef(false);
  setAdvisorJevFilterSkipConfidenceRef(DEFAULT_JEV_FILTER_SKIP_CONFIDENCE);
  setAdvisorJevFilterNoulMarginRef(DEFAULT_JEV_FILTER_NOUL_MARGIN);
  setAdvisorJevFilterOverrideWindowRef(DEFAULT_JEV_FILTER_OVERRIDE_WINDOW);
  setAdvisorJevTimeoutMsRef(DEFAULT_JEV_TIMEOUT_MS);
  setAdvisorJevDigestMaxCharsRef(DEFAULT_JEV_DIGEST_MAX_CHARS);
  setAdvisorJevPricePerMtokRef(DEFAULT_JEV_PRICE_PER_MTOK);
  setAdvisorJevTransportRef(DEFAULT_JEV_TRANSPORT);
  setAdvisorJevTurnGateEveryTurnsRef(DEFAULT_JEV_TURN_GATE_EVERY_TURNS);
  setAdvisorJevTurnGateNoulThresholdRef(DEFAULT_JEV_TURN_GATE_NOUL_THRESHOLD);
  setAdvisorToolResultMaxLinesRef(DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES);
  setAdvisorToolResultMaxBytesRef(DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES);
  setAdvisorRedactSecretsRef(false);
  setAdvisorGitContextRef("summary");
  setAdvisorGitContextMaxCharsRef(DEFAULT_ADVISOR_GIT_CONTEXT_MAX_CHARS);
  setAdvisorToolPoliciesRef({});
  setAdvisorOutcomeLoggingRef(false);
  setAdvisorUntrackedContentRef(false);
  setAdvisorTrackedFileContentRef(false);
  setAdvisorScoutEnabledRef(false);
  setShowUsageDetailsRef(true);
  setShowUsageFooterRef(false);
};

const applyOptionalConfig = <Key extends keyof AdvisorConfig>(
  config: AdvisorConfig,
  key: Key,
  apply: (value: NonNullable<AdvisorConfig[Key]>) => void
) => {
  const value = config[key];
  if (value !== undefined) {
    apply(value);
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

export const applyConfig = (config: AdvisorConfig) => {
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
    "advisorModelWhitelist",
    setAdvisorModelWhitelistRef
  );
  applyOptionalConfig(
    config,
    "advisorSessionSummary",
    setAdvisorSessionSummaryRef
  );
  applyOptionalConfig(config, "advisorScoutEnabled", setAdvisorScoutEnabledRef);
  applyOptionalConfig(config, "showUsageDetails", setShowUsageDetailsRef);
  applyOptionalConfig(config, "showUsageFooter", setShowUsageFooterRef);
  applyOptionalConfig(config, "simpleMode", setSimpleModeRef);
  applyOptionalConfig(config, "alwaysOn", setAlwaysOnRef);
  applyOptionalConfig(config, "gateFailureMode", setAdvisorFailureModeRef);
  applyOptionalConfig(
    config,
    "advisorHerdrIntegration",
    setAdvisorHerdrIntegrationRef
  );
  applyOptionalConfig(
    config,
    "advisorJevFilterEnabled",
    setAdvisorJevFilterEnabledRef
  );
  applyOptionalConfig(
    config,
    "advisorJevFilterSkipConfidence",
    setAdvisorJevFilterSkipConfidenceRef
  );
  applyOptionalConfig(
    config,
    "advisorJevFilterNoulMargin",
    setAdvisorJevFilterNoulMarginRef
  );
  applyOptionalConfig(
    config,
    "advisorJevFilterOverrideWindow",
    setAdvisorJevFilterOverrideWindowRef
  );
  applyNonEmptyStringConfig(config.advisorJevModel, setAdvisorJevModelRef);
  applyOptionalConfig(config, "advisorJevTimeoutMs", setAdvisorJevTimeoutMsRef);
  applyOptionalConfig(
    config,
    "advisorJevDigestMaxChars",
    setAdvisorJevDigestMaxCharsRef
  );
  applyOptionalConfig(
    config,
    "advisorJevPricePerMtok",
    setAdvisorJevPricePerMtokRef
  );
  applyOptionalConfig(config, "advisorJevTransport", setAdvisorJevTransportRef);
  applyOptionalConfig(
    config,
    "advisorJevTurnGateEveryTurns",
    setAdvisorJevTurnGateEveryTurnsRef
  );
  applyOptionalConfig(
    config,
    "advisorJevTurnGateNoulThreshold",
    setAdvisorJevTurnGateNoulThresholdRef
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
  applyOptionalConfig(config, "advisorGitContext", setAdvisorGitContextRef);
  applyOptionalConfig(
    config,
    "advisorGitContextMaxChars",
    setAdvisorGitContextMaxCharsRef
  );
  applyOptionalConfig(config, "advisorToolPolicies", setAdvisorToolPoliciesRef);
  applyOptionalConfig(
    config,
    "advisorUntrackedContent",
    setAdvisorUntrackedContentRef
  );
  applyOptionalConfig(
    config,
    "advisorTrackedFileContent",
    setAdvisorTrackedFileContentRef
  );
  applyOptionalConfig(
    config,
    "advisorOutcomeLogging",
    setAdvisorOutcomeLoggingRef
  );
};
