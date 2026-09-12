import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { advisorScoutEnabledRef, executorRef } from "./config/state.ts";
import {
  runAdvisorScout,
  type ScoutLifecycleEvent,
  type ScoutOutcome,
} from "./scout.ts";
import {
  buildScoutManifest,
  reconstructScoutConversation,
  SCOUT_MANIFEST_MAX_BYTES,
} from "./scout-context.ts";

/** Runs Scout over the manifested branch and reconstructs the curated
 * conversation, falling back to the exact legacy conversation on any
 * non-cancellation Scout failure. */
export const curateAdvisorConversation = async (
  ctx: ExtensionContext,
  legacyConversation: string,
  signal?: AbortSignal,
  onScout?: (event: ScoutLifecycleEvent) => void,
  enabled = advisorScoutEnabledRef,
  runScout: typeof runAdvisorScout = runAdvisorScout,
  currentInvocationId?: string,
  maxChars?: number
): Promise<{
  conversation: string;
  scout?: Exclude<ScoutOutcome, { cancelled: true }>;
}> => {
  if (!enabled) {
    return { conversation: legacyConversation };
  }
  if (maxChars !== undefined && maxChars <= 0) {
    return { conversation: "" };
  }
  const built = buildScoutManifest(ctx, {
    currentInvocationId,
    maxConversationChars: maxChars,
    maxManifestBytes: SCOUT_MANIFEST_MAX_BYTES,
  });
  if (!built.ok) {
    const scout: Exclude<ScoutOutcome, { cancelled: true }> = {
      category: built.reason,
      message: built.message,
      metrics: {
        availableCount: 0,
        inputBytes: 0,
        latencyMs: 0,
        omittedBeforeScout: 0,
        selectedCount: 0,
      },
      model: executorRef,
      ok: false,
    };
    onScout?.({ outcome: scout, type: "fallback" });
    return { conversation: legacyConversation, scout };
  }
  const outcome = await runScout(
    ctx,
    built.manifest,
    signal,
    onScout,
    undefined,
    undefined
  );
  if (!outcome.ok && outcome.cancelled) {
    throw signal?.reason instanceof Error
      ? signal.reason
      : new Error("Advisor operation cancelled during Scout.");
  }
  let conversation = legacyConversation;
  if (outcome.ok) {
    conversation =
      maxChars === undefined
        ? outcome.conversation
        : reconstructScoutConversation(
            built.manifest,
            outcome.selection.selectedIds,
            outcome.selection.synthesis,
            maxChars
          );
  }
  return { conversation, scout: outcome };
};
