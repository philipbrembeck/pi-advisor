import { randomUUID } from "node:crypto";
import type { Message } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  advisorEffortRef,
  advisorGitContextMaxCharsRef,
  advisorGitContextRef,
  advisorRedactSecretsRef,
  advisorRef,
  advisorScoutEnabledRef,
  advisorTrackedFileContentRef,
  advisorUntrackedContentRef,
  contextMaxCharsRef,
  executorRef,
} from "../config/state.js";
import { loadConfig } from "../config/storage.js";
import { redactAndCapText, redactSecrets } from "../conversation.js";
import {
  clampGitContextLevel,
  collectGitContext,
  type GitContextLevel,
} from "../git.js";
import { collectTextStream, resolveConfiguredModel } from "../model-stream.js";
import { readProjectPreferences } from "../preferences.js";
import {
  runAdvisorScout,
  type ScoutLifecycleEvent,
  type ScoutOutcome,
} from "../scout.js";
import {
  buildScoutManifest,
  reconstructScoutConversation,
  SCOUT_MANIFEST_MAX_BYTES,
} from "../scout-context.js";
import type { ConsultationTrigger, GateTrigger } from "../session-state.js";
import { readTrackedFiles, readUntrackedFiles } from "../untracked.js";
import { parseAutomaticDecision } from "./gate-protocol.js";
import {
  ADVISOR_DECISION_SYSTEM,
  ADVISOR_SYSTEM,
  advisorGitContextBudget,
  advisorMessageText,
  advisorRepositoryContext,
  advisorRequestConversation,
} from "./prompts.js";
import type { AdvisorConsultationResult, AdvisorGateOutcome } from "./types.js";

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

const collectAdvisorResponse = async (
  ctx: ExtensionContext,
  systemPrompt: string,
  question: string | undefined,
  signal: AbortSignal | undefined,
  onChunk: ((thinking: string, text: string) => void) | undefined,
  gitContext?: GitContextLevel,
  draft?: string,
  includeUntracked?: string[],
  includeTracked?: string[],
  onScout?: (event: ScoutLifecycleEvent) => void,
  currentInvocationId?: string
) => {
  loadConfig(ctx);
  const resolved = await resolveConfiguredModel(ctx, advisorRef, "Advisor");

  // The user setting is the ceiling; the Executor may only narrow it.
  const allowed = advisorGitContextRef;
  const level = clampGitContextLevel(gitContext ?? allowed, allowed);
  const gitBudget = advisorGitContextBudget(
    contextMaxCharsRef,
    advisorGitContextMaxCharsRef
  );
  const changes = collectGitContext(
    ctx.cwd,
    level,
    gitBudget,
    advisorRedactSecretsRef ? redactSecrets : undefined
  );
  // The note is placed first so a cap can never drop the statement that the
  // Advisor's view of the repository is limited.
  // The disclosure warning is control metadata, not repository payload. Keep it
  // outside the zero-byte Git budget so disabling disclosure cannot erase it.
  const changeText = advisorRepositoryContext(
    changes,
    gitContext ?? allowed,
    level,
    gitBudget
  );
  // Repository context spends part of the shared budget, so a large patch
  // cannot silently push the conversation past the model's context window.
  const conversationBudget = Math.max(
    0,
    contextMaxCharsRef - changeText.length
  );
  const legacyConversation = advisorRequestConversation(
    ctx,
    conversationBudget
  );
  const curated = await curateAdvisorConversation(
    ctx,
    legacyConversation,
    signal,
    onScout,
    advisorScoutEnabledRef,
    runAdvisorScout,
    currentInvocationId,
    conversationBudget
  );
  const { conversation, scout } = curated;
  const preferences = await readProjectPreferences(
    ctx,
    8 * 1024,
    advisorRedactSecretsRef
  );
  const draftText = draft
    ? redactAndCapText(draft, 8 * 1024, advisorRedactSecretsRef)
    : undefined;
  const untracked = await readUntrackedFiles(
    ctx.cwd,
    includeUntracked ?? [],
    advisorUntrackedContentRef,
    advisorRedactSecretsRef
  );
  const tracked = await readTrackedFiles(
    ctx.cwd,
    includeTracked ?? [],
    advisorTrackedFileContentRef,
    advisorRedactSecretsRef,
    Math.max(
      0,
      24 * 1024 - untracked.reduce((sum, item) => sum + item.bytes, 0)
    )
  );
  const messages: Message[] = [
    {
      content: [
        {
          text: advisorMessageText(
            conversation,
            question,
            changeText,
            draftText,
            preferences?.text,
            untracked.map(
              (item) =>
                `<file path=${JSON.stringify(item.path)}>\n${item.text}\n</file>`
            ),
            tracked.map(
              (item) =>
                `<file path=${JSON.stringify(item.path)}>\n${item.text}\n</file>`
            )
          ),
          type: "text",
        },
      ],
      role: "user",
      timestamp: Date.now(),
    },
  ];

  const streamed = await collectTextStream(resolved, {
    messages,
    onChunk,
    reasoning: advisorEffortRef,
    signal,
    systemPrompt,
  });
  const markdown = streamed.text;
  if (!markdown.trim()) {
    throw new Error("Advisor returned no advice.");
  }
  return {
    draftBytes: draftText ? Buffer.byteLength(draftText, "utf8") : undefined,
    markdown,
    model: advisorRef,
    preferenceBytes: preferences?.bytes,
    thinkingText: streamed.thinking,
    trackedBytes:
      tracked.reduce((sum, item) => sum + item.bytes, 0) || undefined,
    untrackedBytes:
      untracked.reduce((sum, item) => sum + item.bytes, 0) || undefined,
    usage: streamed.usage,
    ...(scout ? { scout } : {}),
  };
};

export const consultAdvisor = async (
  ctx: ExtensionContext,
  question?: string,
  signal?: AbortSignal,
  onChunk?: (thinking: string, text: string) => void,
  trigger: ConsultationTrigger = "executor-requested",
  gitContext?: GitContextLevel,
  draft?: string,
  includeUntracked?: string[],
  includeTracked?: string[],
  onScout?: (event: ScoutLifecycleEvent) => void,
  currentInvocationId?: string
): Promise<AdvisorConsultationResult> => {
  const result = await collectAdvisorResponse(
    ctx,
    ADVISOR_SYSTEM,
    question,
    signal,
    onChunk,
    gitContext,
    draft,
    includeUntracked,
    includeTracked,
    onScout,
    currentInvocationId
  );
  return { ...result, adviceId: randomUUID(), trigger };
};

export const runAdvisorGate = async (
  ctx: ExtensionContext,
  question: string,
  trigger: GateTrigger = "repeated-tool-call",
  signal?: AbortSignal,
  onChunk?: (thinking: string, text: string) => void,
  onScout?: (event: ScoutLifecycleEvent) => void,
  currentInvocationId?: string
): Promise<AdvisorGateOutcome> => {
  try {
    const result = await collectAdvisorResponse(
      ctx,
      ADVISOR_DECISION_SYSTEM,
      question,
      signal,
      onChunk,
      undefined,
      undefined,
      undefined,
      undefined,
      onScout,
      currentInvocationId
    );
    const parsed = parseAutomaticDecision(result.markdown);
    if (!parsed.ok) {
      return { ...parsed, usage: result.usage };
    }
    return {
      ...parsed,
      model: result.model,
      thinkingText: result.thinkingText,
      trigger,
      usage: result.usage,
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      category:
        message === "Advisor returned no advice."
          ? "empty-response"
          : "provider-error",
      message,
      ok: false,
    };
  }
};
