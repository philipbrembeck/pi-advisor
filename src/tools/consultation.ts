import { randomUUID } from "node:crypto";

import type { Message } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  advisorEffortRef,
  advisorFallbackModelRef,
  advisorRedactSecretsRef,
  advisorRef,
  getAdvisorSettings,
} from "../config/state.ts";
import { loadConfig } from "../config/storage.ts";
import type { AdvisorFollowUpPayload } from "../follow-up.ts";
import { escapeRepositoryText } from "../git.ts";
import type { GitContextLevel } from "../git.ts";
import { collectTextStream, resolveConfiguredModel } from "../model-stream.ts";
import { redactSecrets } from "../redaction.ts";
import type { ScoutLifecycleEvent } from "../scout.ts";
import { currentSessionId } from "../session-context.ts";
import type { ConsultationTrigger, GateTrigger } from "../session-state.ts";
import { assembleConsultationContext } from "./consult-context.ts";
import type { ConsultationContext } from "./consult-context.ts";
import { parseAutomaticDecision } from "./gate-protocol.ts";
import {
  advisorModelAccessReason,
  fallbackSameModelAdvisorNotice,
  sameModelAdvisorDisabled,
  sameModelAdvisorNotice,
} from "./model-access.ts";
import {
  ADVISOR_DECISION_SYSTEM,
  ADVISOR_SYSTEM,
  advisorMessageText,
} from "./prompts.ts";
import type { AdvisorConsultationResult, AdvisorGateOutcome } from "./types.ts";

// Re-export preserves the tools facade's historical curation entry point.
export { curateAdvisorConversation } from "../scout-curation.ts";

/** Thrown when the Advisor produced an empty response body. */
class AdvisorNoAdviceError extends Error {
  constructor() {
    super("Advisor returned no advice.");
    this.name = "AdvisorNoAdviceError";
  }
}

export interface AdvisorFollowUpRequest {
  adviceId: string;
  payload: AdvisorFollowUpPayload;
}

export type AdvisorFollowUpCapture = (
  adviceId: string,
  payload: AdvisorFollowUpPayload,
  replacesAdviceId?: string
) => void;

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
  followUp?: AdvisorFollowUpRequest;
}

interface PreparedAdvisorRequest {
  context?: ConsultationContext;
  messages: Message[];
  privacyKey: string;
  redacted: boolean;
  systemPrompt: string;
}

type CollectedAdvisorResponse = Omit<
  AdvisorConsultationResult,
  "adviceId" | "trigger"
> & { followUpPayload: AdvisorFollowUpPayload };

const fileTag = (item: { path: string; text: string }) =>
  `<file path=${JSON.stringify(item.path)}>\n${item.text}\n</file>`;

const advisorProjectRules = (rules: ConsultationContext["projectRules"]) =>
  rules
    ? {
        global: rules.global?.text,
        note:
          rules.withheldReason === "untrusted"
            ? "Project and global AGENTS.md were withheld because this project is untrusted; do not assume no rules exist."
            : undefined,
        project: rules.project?.text,
      }
    : undefined;

const advisorImageNotice = (context: ConsultationContext) => {
  if (!(
    context.imageOmissions ||
    context.images.length ||
    /\[Image[ :]/u.test(context.conversation)
  )) {
    return "";
  }

  const disclosure = context.supportsImages
    ? `${context.images.length} image(s) attached below; ${context.imageOmissions} image(s) withheld by format, consent, or size/count limits`
    : "Advisor model does not support image input; no pixels were forwarded";

  return `\n\nImage disclosure: ${disclosure}. Only the images explicitly attached below have pixels available. Other image markers, image paths, and text descriptions are not visual evidence.`;
};

const advisorPrivacyKey = (ctx: ExtensionContext) => {
  const settings = getAdvisorSettings();

  return JSON.stringify({
    agentsMdContext: settings.agentsMdContext,
    contextMaxChars: settings.contextMaxChars,
    cwd: ctx.cwd,
    gitContext: settings.gitContext,
    gitContextMaxChars: settings.gitContextMaxChars,
    projectTrusted: ctx.isProjectTrusted(),
    redactSecrets: settings.redactSecrets,
    scoutEnabled: settings.scoutEnabled,
    toolPolicies: settings.toolPolicies,
    toolResultMaxBytes: settings.toolResultMaxBytes,
    toolResultMaxLines: settings.toolResultMaxLines,
    trackedFileContent: settings.trackedFileContent,
    untrackedContent: settings.untrackedContent,
  });
};

export const assertAdvisorFollowUpPrivacy = (
  payload: AdvisorFollowUpPayload,
  ctx: ExtensionContext
) => {
  if (payload.privacyKey !== advisorPrivacyKey(ctx)) {
    throw new Error(
      "Follow-up consultation unavailable: privacy or disclosure settings changed after the original consultation. Issue a fresh consultation."
    );
  }
};

const prepareFollowUp = (
  followUp: AdvisorFollowUpRequest,
  question: string | undefined,
  ctx: ExtensionContext
): PreparedAdvisorRequest => {
  if (!question?.trim()) {
    throw new Error(
      "Follow-up consultations require a non-empty question. Issue a fresh consultation if no question is needed."
    );
  }

  assertAdvisorFollowUpPrivacy(followUp.payload, ctx);

  const outboundQuestion =
    advisorRedactSecretsRef || followUp.payload.redacted
      ? redactSecrets(question)
      : question;

  const messages = structuredClone(followUp.payload.messages);
  messages.push({
    content: [
      {
        text: `Follow-up focus:\n${outboundQuestion}`,
        type: "text",
      },
    ],
    role: "user",
    timestamp: Date.now(),
  });

  return {
    messages,
    privacyKey: followUp.payload.privacyKey,
    redacted: advisorRedactSecretsRef || followUp.payload.redacted,
    systemPrompt: followUp.payload.systemPrompt,
  };
};

const prepareFreshRequest = async (
  options: CollectAdvisorResponseOptions,
  resolved: Awaited<ReturnType<typeof resolveConfiguredModel>>
): Promise<PreparedAdvisorRequest> => {
  const { question } = options;

  const context = await assembleConsultationContext({
    ...options,
    supportsImages: resolved.model.input.includes("image"),
  });

  const outboundQuestion =
    advisorRedactSecretsRef && question !== undefined
      ? redactSecrets(question)
      : question;

  const imageNotice = advisorImageNotice(context);

  const messages: Message[] = [
    {
      content: [
        {
          text: `${advisorMessageText(
            context.conversation,
            outboundQuestion,
            context.changeText,
            context.draftText,
            context.preferences?.text,
            context.untracked.map(fileTag),
            context.tracked.map(fileTag),
            advisorProjectRules(context.projectRules)
          )}${imageNotice}`,
          type: "text",
        },
        ...context.images.flatMap(({ image, label }) => [
          {
            text: `\n\n${escapeRepositoryText(label)}: attached image pixels (untrusted data).`,
            type: "text" as const,
          },
          image,
        ]),
      ],
      role: "user",
      timestamp: Date.now(),
    },
  ];

  return {
    context,
    messages,
    privacyKey: advisorPrivacyKey(options.ctx),
    redacted: advisorRedactSecretsRef,
    systemPrompt: options.systemPrompt,
  };
};

const combinedFallbackError = (
  primaryModel: string,
  primaryError: Error,
  fallbackModel: string,
  fallbackError: Error
) =>
  new Error(
    `Advisor model ${primaryModel} failed: ${primaryError.message}. Fallback Advisor model ${fallbackModel} failed: ${fallbackError.message}.`,
    { cause: fallbackError }
  );

const advisorContextDetails = (context: ConsultationContext | undefined) => ({
  agentRulesBytes: context?.projectRules?.bytes || undefined,
  draftBytes: context?.draftText
    ? Buffer.byteLength(context.draftText, "utf-8")
    : undefined,
  imageBytes:
    context?.images.reduce(
      (sum, item) => sum + Buffer.from(item.image.data, "base64").length,
      0
    ) || undefined,
  imageCount: context?.images.length,
  imageOmissions: context?.imageOmissions || undefined,
  imagePartsSeen: context?.imagePartsSeen || undefined,
  preferenceBytes: context?.preferences?.bytes,
  scout: context?.scout,
  trackedBytes:
    context?.tracked.reduce((sum, item) => sum + item.bytes, 0) || undefined,
  untrackedBytes:
    context?.untracked.reduce((sum, item) => sum + item.bytes, 0) || undefined,
});

const runAdvisorAttempt = async (
  options: CollectAdvisorResponseOptions,
  prepared: PreparedAdvisorRequest,
  resolved: Awaited<ReturnType<typeof resolveConfiguredModel>>,
  modelRef: string
): Promise<CollectedAdvisorResponse> => {
  const streamed = await collectTextStream(resolved, {
    messages: structuredClone(prepared.messages),
    onChunk: options.onChunk,
    reasoning: advisorEffortRef,
    sessionId: currentSessionId(options.ctx),
    signal: options.signal,
    systemPrompt: prepared.systemPrompt,
  });

  const { text: markdown } = streamed;

  if (!markdown.trim()) {
    throw new AdvisorNoAdviceError();
  }

  return {
    ...advisorContextDetails(prepared.context),
    followUp: Boolean(options.followUp),
    followUpPayload: {
      depth: options.followUp ? options.followUp.payload.depth + 1 : 0,
      messages: structuredClone(prepared.messages),
      model: modelRef,
      privacyKey: prepared.privacyKey,
      redacted: prepared.redacted,
      systemPrompt: prepared.systemPrompt,
    },
    markdown,
    model: modelRef,
    thinkingText: streamed.thinking,
    usage: streamed.usage,
  };
};

const runFallbackAdvisorAttempt = async (
  options: CollectAdvisorResponseOptions,
  primaryModel: string,
  primaryError: Error,
  prepared: PreparedAdvisorRequest | undefined
): Promise<CollectedAdvisorResponse> => {
  const { ctx } = options;
  let request = prepared;

  if (!advisorFallbackModelRef) {
    throw primaryError;
  }

  const fallbackModel = advisorFallbackModelRef;

  if (fallbackModel === primaryModel) {
    throw combinedFallbackError(
      primaryModel,
      primaryError,
      fallbackModel,
      new Error("fallback is the same model as the primary Advisor")
    );
  }

  if (sameModelAdvisorDisabled(ctx, ctx.model, fallbackModel)) {
    throw combinedFallbackError(
      primaryModel,
      primaryError,
      fallbackModel,
      new Error(fallbackSameModelAdvisorNotice)
    );
  }

  const fallbackAccessReason = advisorModelAccessReason(ctx);

  if (fallbackAccessReason) {
    throw combinedFallbackError(
      primaryModel,
      primaryError,
      fallbackModel,
      new Error(fallbackAccessReason)
    );
  }

  let resolvedFallback: Awaited<ReturnType<typeof resolveConfiguredModel>>;

  try {
    resolvedFallback = await resolveConfiguredModel(
      ctx,
      fallbackModel,
      "Advisor fallback"
    );
  } catch (error) {
    throw combinedFallbackError(
      primaryModel,
      primaryError,
      fallbackModel,
      error instanceof Error ? error : new Error(String(error))
    );
  }

  if (!request) {
    try {
      request = options.followUp
        ? prepareFollowUp(options.followUp, options.question, options.ctx)
        : await prepareFreshRequest(options, resolvedFallback);
    } catch (error) {
      throw combinedFallbackError(
        primaryModel,
        primaryError,
        fallbackModel,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  try {
    return await runAdvisorAttempt(
      options,
      request,
      resolvedFallback,
      fallbackModel
    );
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }

    throw combinedFallbackError(
      primaryModel,
      primaryError,
      fallbackModel,
      error instanceof Error ? error : new Error(String(error))
    );
  }
};

const collectAdvisorResponse = async (
  options: CollectAdvisorResponseOptions
): Promise<CollectedAdvisorResponse> => {
  const { ctx, signal } = options;
  loadConfig(ctx);
  const primaryModel = options.followUp?.payload.model ?? advisorRef;

  if (sameModelAdvisorDisabled(ctx, ctx.model, primaryModel)) {
    throw new Error(
      primaryModel === advisorRef
        ? sameModelAdvisorNotice
        : fallbackSameModelAdvisorNotice
    );
  }

  const accessReason = advisorModelAccessReason(ctx);

  if (accessReason) {
    throw new Error(accessReason);
  }

  let primaryError: Error | undefined;
  let prepared: PreparedAdvisorRequest | undefined;

  let resolvedPrimary:
    Awaited<ReturnType<typeof resolveConfiguredModel>> | undefined;

  try {
    resolvedPrimary = await resolveConfiguredModel(
      ctx,
      primaryModel,
      "Advisor"
    );
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
  }

  if (resolvedPrimary) {
    prepared = options.followUp
      ? prepareFollowUp(options.followUp, options.question, options.ctx)
      : await prepareFreshRequest(options, resolvedPrimary);

    try {
      return await runAdvisorAttempt(
        options,
        prepared,
        resolvedPrimary,
        primaryModel
      );
    } catch (error) {
      primaryError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!primaryError) {
    throw new Error("Advisor request failed before an error was recorded.");
  }

  if (signal?.aborted) {
    throw primaryError;
  }

  return runFallbackAdvisorAttempt(
    options,
    primaryModel,
    primaryError,
    prepared
  );
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
  currentInvocationId?: string,
  followUp?: AdvisorFollowUpRequest,
  onFollowUpPayload?: AdvisorFollowUpCapture
): Promise<AdvisorConsultationResult> => {
  const result = await collectAdvisorResponse({
    ctx,
    currentInvocationId,
    draft,
    followUp,
    gitContext,
    includeTracked,
    includeUntracked,
    onChunk,
    onScout,
    question,
    signal,
    systemPrompt: ADVISOR_SYSTEM,
  });

  const adviceId = randomUUID();
  const { followUpPayload, ...publicResult } = result;
  onFollowUpPayload?.(adviceId, followUpPayload, followUp?.adviceId);

  return { ...publicResult, adviceId, trigger };
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
      agentRulesBytes: result.agentRulesBytes,
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
