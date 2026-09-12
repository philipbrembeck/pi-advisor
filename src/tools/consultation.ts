import { randomUUID } from "node:crypto";
import type { Message } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  advisorEffortRef,
  advisorRedactSecretsRef,
  advisorRef,
} from "../config/state.ts";
import { loadConfig } from "../config/storage.ts";
import type { GitContextLevel } from "../git.ts";
import { collectTextStream, resolveConfiguredModel } from "../model-stream.ts";
import { redactSecrets } from "../redaction.ts";
import type { ScoutLifecycleEvent } from "../scout.ts";
import type { ConsultationTrigger, GateTrigger } from "../session-state.ts";
import { assembleConsultationContext } from "./consult-context.ts";
import { parseAutomaticDecision } from "./gate-protocol.ts";
import {
  ADVISOR_DECISION_SYSTEM,
  ADVISOR_SYSTEM,
  advisorMessageText,
} from "./prompts.ts";
import type { AdvisorConsultationResult, AdvisorGateOutcome } from "./types.ts";

// biome-ignore lint/performance/noBarrelFile: preserves the tools facade's historical re-export of the moved curation entry point.
export { curateAdvisorConversation } from "../scout-curation.ts";

/** Thrown when the Advisor produced an empty response body. */
class AdvisorNoAdviceError extends Error {
  constructor() {
    super("Advisor returned no advice.");
    this.name = "AdvisorNoAdviceError";
  }
}

interface CollectAdvisorResponseOptions {
  ctx: ExtensionContext;
  currentInvocationId?: string;
  draft?: string;
  gitContext?: GitContextLevel;
  includeTracked?: string[];
  includeUntracked?: string[];
  onChunk?: (thinking: string, text: string) => void;
  onScout?: (event: ScoutLifecycleEvent) => void;
  question?: string;
  signal?: AbortSignal;
  systemPrompt: string;
}

const fileTag = (item: { path: string; text: string }) =>
  `<file path=${JSON.stringify(item.path)}>\n${item.text}\n</file>`;

const collectAdvisorResponse = async (
  options: CollectAdvisorResponseOptions
) => {
  const { ctx, question, signal, systemPrompt } = options;
  loadConfig(ctx);
  const resolved = await resolveConfiguredModel(ctx, advisorRef, "Advisor");
  const context = await assembleConsultationContext(options);

  // Keep the original question available to local UI callers, but never send
  // its credential-shaped values to the provider when redaction is enabled.
  const outboundQuestion =
    advisorRedactSecretsRef && question !== undefined
      ? redactSecrets(question)
      : question;
  const messages: Message[] = [
    {
      content: [
        {
          text: advisorMessageText(
            context.conversation,
            outboundQuestion,
            context.changeText,
            context.draftText,
            context.preferences?.text,
            context.untracked.map(fileTag),
            context.tracked.map(fileTag)
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
    onChunk: options.onChunk,
    reasoning: advisorEffortRef,
    signal,
    systemPrompt,
  });
  const markdown = streamed.text;
  if (!markdown.trim()) {
    throw new AdvisorNoAdviceError();
  }
  return {
    draftBytes: context.draftText
      ? Buffer.byteLength(context.draftText, "utf8")
      : undefined,
    markdown,
    model: advisorRef,
    preferenceBytes: context.preferences?.bytes,
    thinkingText: streamed.thinking,
    trackedBytes:
      context.tracked.reduce((sum, item) => sum + item.bytes, 0) || undefined,
    untrackedBytes:
      context.untracked.reduce((sum, item) => sum + item.bytes, 0) || undefined,
    usage: streamed.usage,
    ...(context.scout ? { scout: context.scout } : {}),
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
  const result = await collectAdvisorResponse({
    ctx,
    currentInvocationId,
    draft,
    gitContext,
    includeTracked,
    includeUntracked,
    onChunk,
    onScout,
    question,
    signal,
    systemPrompt: ADVISOR_SYSTEM,
  });
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
    const result = await collectAdvisorResponse({
      ctx,
      currentInvocationId,
      onChunk,
      onScout,
      question,
      signal,
      systemPrompt: ADVISOR_DECISION_SYSTEM,
    });
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
        error instanceof AdvisorNoAdviceError
          ? "empty-response"
          : "provider-error",
      message,
      ok: false,
    };
  }
};
