import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getPersistedModelRefs,
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
  setAdvisorLoopThresholdRef,
  setAdvisorMaxCallsPerSessionRef,
  setAdvisorOutcomeLoggingRef,
  setAdvisorPlanGateRef,
  setAdvisorRedactSecretsRef,
  setAdvisorScoutEnabledRef,
  setAdvisorSessionSummaryRef,
  setAdvisorToolPoliciesRef,
  setAdvisorToolResultMaxBytesRef,
  setAdvisorToolResultMaxLinesRef,
  setAdvisorTrackedFileContentRef,
  setAdvisorUntrackedContentRef,
  setAlwaysOnRef,
  setContextMaxCharsRef,
  setShowUsageDetailsRef,
  setShowUsageFooterRef,
  setSimpleModeRef,
} from "../config/state.js";
import { saveConfig, saveGlobalOutcomeLogging } from "../config/storage.js";
import type { AdvisorSettings } from "../ui/types.js";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one settings form maps every persisted control.
export const applyAdvisorSettings = (settings: AdvisorSettings) => {
  setAdvisorEffortRef(
    settings.effort === "Default (Model Default)" ? undefined : settings.effort
  );
  setContextMaxCharsRef(settings.contextMaxChars);
  setAdvisorPlanGateRef(settings.planGate);
  setAdvisorFailureGateRef(settings.failureGate);
  setAdvisorCompletionGateRef(settings.completionGate);
  setAdvisorCollapseResponsesRef(settings.collapseResponses);
  setAdvisorCustomInvocationRef(settings.customRule);
  setAdvisorBlockOnBlockedRef(settings.blockOnBlocked ?? true);
  setAdvisorAutoLoopGateRef(settings.autoLoopGate ?? true);
  setAdvisorLoopThresholdRef(settings.loopThreshold ?? 3);
  setAdvisorMaxCallsPerSessionRef(settings.maxCallsPerSession);
  setAdvisorSessionSummaryRef(settings.sessionSummary ?? false);
  setAdvisorScoutEnabledRef(settings.scoutEnabled ?? false);
  setShowUsageDetailsRef(settings.showUsageDetails ?? true);
  setShowUsageFooterRef(settings.showUsageFooter ?? false);
  setSimpleModeRef(settings.simpleMode ?? false);
  setAlwaysOnRef(settings.alwaysOn ?? false);
  setAdvisorFailureModeRef(settings.failureMode ?? "block-session");
  setAdvisorHerdrIntegrationRef(settings.herdrIntegration ?? true);
  setAdvisorToolResultMaxLinesRef(settings.toolResultMaxLines ?? 2000);
  setAdvisorToolResultMaxBytesRef(settings.toolResultMaxBytes ?? 50 * 1024);
  setAdvisorRedactSecretsRef(settings.redactSecrets ?? false);
  setAdvisorGitContextRef(settings.gitContext ?? "summary");
  setAdvisorGitContextMaxCharsRef(settings.gitContextMaxChars ?? 20_000);
  setAdvisorToolPoliciesRef(settings.toolPolicies ?? {});
  setAdvisorTrackedFileContentRef(settings.trackedFileContent ?? false);
  setAdvisorUntrackedContentRef(settings.untrackedContent ?? false);
  setAdvisorOutcomeLoggingRef(settings.outcomeLogging ?? false);
};

export const saveAdvisorSettings = (
  ctx: ExtensionContext,
  settings: AdvisorSettings
) => {
  applyAdvisorSettings(settings);
  const persisted = getPersistedModelRefs();
  saveConfig(ctx, {
    persistAdvisor: Boolean(persisted.advisor),
    persistExecutor: Boolean(persisted.executor),
  });
  saveGlobalOutcomeLogging(settings.outcomeLogging ?? false);
};
