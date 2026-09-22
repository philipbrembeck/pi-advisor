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
} from "../config/state.ts";
import { saveConfig, saveGlobalOutcomeLogging } from "../config/storage.ts";
import {
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
} from "../config/types.ts";
import type { AdvisorSettings } from "../ui/types.ts";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one settings form maps every persisted control.
const applyAdvisorSettings = (settings: AdvisorSettings) => {
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
  setAdvisorModelWhitelistRef(settings.modelWhitelist ?? []);
  setAdvisorSessionSummaryRef(settings.sessionSummary ?? false);
  setAdvisorScoutEnabledRef(settings.scoutEnabled ?? false);
  setShowUsageDetailsRef(settings.showUsageDetails ?? true);
  setShowUsageFooterRef(settings.showUsageFooter ?? false);
  setSimpleModeRef(settings.simpleMode ?? false);
  setAlwaysOnRef(settings.alwaysOn ?? false);
  setAdvisorFailureModeRef(settings.failureMode ?? "block-session");
  setAdvisorHerdrIntegrationRef(settings.herdrIntegration ?? true);
  setAdvisorJevFilterEnabledRef(settings.jevFilterEnabled ?? false);
  setAdvisorJevFilterSkipConfidenceRef(
    settings.jevFilterSkipConfidence ?? DEFAULT_JEV_FILTER_SKIP_CONFIDENCE
  );
  setAdvisorJevFilterNoulMarginRef(
    settings.jevFilterNoulMargin ?? DEFAULT_JEV_FILTER_NOUL_MARGIN
  );
  setAdvisorJevFilterOverrideWindowRef(
    settings.jevFilterOverrideWindow ?? DEFAULT_JEV_FILTER_OVERRIDE_WINDOW
  );
  setAdvisorJevModelRef(settings.jevModel ?? DEFAULT_JEV_MODEL);
  setAdvisorJevTimeoutMsRef(settings.jevTimeoutMs ?? DEFAULT_JEV_TIMEOUT_MS);
  setAdvisorJevDigestMaxCharsRef(
    settings.jevDigestMaxChars ?? DEFAULT_JEV_DIGEST_MAX_CHARS
  );
  setAdvisorJevPricePerMtokRef(
    settings.jevPricePerMtok ?? DEFAULT_JEV_PRICE_PER_MTOK
  );
  setAdvisorJevTransportRef(settings.jevTransport ?? DEFAULT_JEV_TRANSPORT);
  setAdvisorJevTurnGateEveryTurnsRef(
    settings.jevTurnGateEveryTurns ?? DEFAULT_JEV_TURN_GATE_EVERY_TURNS
  );
  setAdvisorJevTurnGateNoulThresholdRef(
    settings.jevTurnGateNoulThreshold ?? DEFAULT_JEV_TURN_GATE_NOUL_THRESHOLD
  );
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
