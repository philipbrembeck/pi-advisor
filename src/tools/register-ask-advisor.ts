import type { Usage } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";

import {
  advisorRef,
  getAdvisorMaxCallsPerSession,
  getAdvisorSettings,
  isSimpleMode,
} from "../config/state.ts";
import { loadConfig } from "../config/storage.ts";
import type { AdvisorFollowUpPayload } from "../follow-up.ts";
import { notifyHerdrAdvisorFailure } from "../herdr.ts";
import {
  ADVISOR_STREAM_UPDATE_INTERVAL_MS,
  createCoalescedUpdate,
} from "../model-stream.ts";
import {
  advisorUsageCost,
  advisorUsageForPi,
  combineAdvisorAndClassifierUsage,
  snapshotAdvisorUsage,
} from "../usage.ts";
import { advisorOutputSchema } from "./advisor-output.ts";
import { assertAdvisorFollowUpPrivacy } from "./consultation.ts";
import { notifyLocalFailure, updateAdvisorUsageStatus } from "./gate-policy.ts";
import { normalizeScreeningQuestion, screeningSkipText } from "./jev-filter.ts";
import {
  advisorModelAccessReason,
  fallbackSameModelAdvisorNotice,
  sameModelAdvisorDisabled,
  sameModelAdvisorNotice,
} from "./model-access.ts";
import { renderAdvisorResult } from "./render-advisor-result.ts";
import {
  renderAdvisorCallBox,
  resolveAdvisorRequest,
} from "./render-common.ts";
import { scoutDetailsFromEvent } from "./scout-status.ts";
import type {
  AdvisorToolContext,
  AdvisorToolDetails,
  ToolRegistrationContext,
} from "./types.ts";

const assertAdvisorModelAccess = (ctx: ExtensionContext) => {
  const accessReason = advisorModelAccessReason(ctx);

  if (accessReason) {
    throw new Error(accessReason);
  }
};

interface AskAdvisorParams {
  draft?: string;
  followUpTo?: string;
  force?: boolean;
  gitContext?: "none" | "summary" | "full";
  includeTrackedFiles?: string[];
  includeUntracked?: string[];
  question?: string;
}

const resolveFollowUp = (
  params: AskAdvisorParams,
  session: ToolRegistrationContext["session"]
): { adviceId: string; payload: AdvisorFollowUpPayload } | undefined => {
  if (!params.followUpTo) {
    return undefined;
  }

  if (
    !params.question?.trim() ||
    params.draft !== undefined ||
    params.gitContext !== undefined ||
    params.includeTrackedFiles?.length ||
    params.includeUntracked?.length
  ) {
    throw new Error(
      "Follow-up consultations accept only followUpTo and a non-empty question. Issue a fresh consultation for new context or attachments."
    );
  }

  const cached = session.followUpFor(params.followUpTo);

  if (!cached.payload) {
    throw new Error(
      `Follow-up unavailable for adviceId ${params.followUpTo}: ${cached.reason ?? "the cached payload is unavailable"}. Issue a fresh consultation.`
    );
  }

  return { adviceId: params.followUpTo, payload: cached.payload };
};

const sameModelNoticeFor = (modelRef: string | undefined) =>
  (modelRef ?? advisorRef) === advisorRef
    ? sameModelAdvisorNotice
    : fallbackSameModelAdvisorNotice;

const skippedSameModelResult = (
  id: string,
  notice: string,
  reservedCalls: Set<string>,
  session: ToolRegistrationContext["session"]
) => {
  session.releaseCall(id);
  reservedCalls.delete(id);

  return {
    content: [{ text: notice, type: "text" as const }],
    details: {
      skipReason: notice,
      text: notice,
    },
    structuredContent: { skipReason: notice, text: notice },
  };
};

const claimTrackedHandoff = (
  session: ToolRegistrationContext["session"],
  includeTrackedFiles: string[] | undefined
) => {
  if (!includeTrackedFiles?.length) {
    return;
  }

  if (!getAdvisorSettings().trackedFileContent) {
    throw new Error(
      "Tracked file attachments are disabled: enable the global advisorTrackedFileContent setting (Tracked file content in /advisor-settings) and retry."
    );
  }

  if (!session.claimTrackedFiles(includeTrackedFiles)) {
    throw new Error(
      "Tracked file handoff requires a prior Advisor response that explicitly names every requested path and is consumed once."
    );
  }
};

export const registerAskAdvisorTool = ({
  consult: requestAdvisor,
  herdrActivity,
  pi,
  reservedCalls,
  screen,
  session,
}: ToolRegistrationContext): void => {
  pi.registerTool({
    description:
      "Consult the on-demand Advisor model for strategic guidance. Call with an empty object for a contextual review; attach an optional draft for concrete plan or completion review. Use followUpTo with a new question to continue one cached consultation without rebuilding its redacted context. If the Advisor explicitly names a missing file, you may make a sequential fresh consultation with includeTrackedFiles when enabled and relevant. In Pi Codemode, gather and filter deterministic tool results first, then call tools.ask_advisor. Nested results are not automatically reconstructed: pass only permitted, concise summaries in draft (untrusted, capped at 8 KiB, not independently verified). Draft does not inherit source-tool disclosure policies; use gitContext for patches within the user's allowance.",
    async execute(_id, params, signal, onUpdate, ctx) {
      let followUp:
        | { adviceId: string; payload: AdvisorFollowUpPayload }
        | undefined;

      try {
        loadConfig(ctx);
        followUp = resolveFollowUp(params, session);

        if (followUp) {
          assertAdvisorFollowUpPrivacy(followUp.payload, ctx);
        }

        const modelRef = followUp?.payload.model;

        if (sameModelAdvisorDisabled(ctx, ctx.model, modelRef)) {
          return skippedSameModelResult(
            _id,
            sameModelNoticeFor(modelRef),
            reservedCalls,
            session
          );
        }

        assertAdvisorModelAccess(ctx);
      } catch (error) {
        session.releaseCall(_id);
        reservedCalls.delete(_id);
        throw error;
      }

      let classifierUsage: Usage | undefined;
      const simpleMode = isSimpleMode();

      if (
        !simpleMode &&
        !session.reserveCall(_id, getAdvisorMaxCallsPerSession())
      ) {
        throw new Error("Advisor call budget exhausted for this session.");
      }

      if (simpleMode) {
        session.releaseCall(_id);
        reservedCalls.delete(_id);
      } else {
        reservedCalls.add(_id);
      }

      let normalizedQuestion: string | undefined;

      try {
        if (
          !simpleMode &&
          !session.canConsult(getAdvisorMaxCallsPerSession(), _id)
        ) {
          throw new Error("Advisor call budget exhausted for this session.");
        }

        // The Jev screening seam sits before the handoff claim: a skipped call
        // consumes neither the one-shot handoff nor the budget.
        normalizedQuestion = normalizeScreeningQuestion(
          resolveAdvisorRequest(params.question)
        );

        const screening = await screen(ctx, session, {
          draft: params.draft,
          force: params.force,
          question: resolveAdvisorRequest(params.question),
          signal,
        });

        classifierUsage = screening.usage;

        if (screening.decision === "skip") {
          const skipText = screeningSkipText(screening);
          session.releaseCall(_id);
          reservedCalls.delete(_id);

          const skipped = {
            jev: {
              kind: screening.kind,
              reason: screening.reason,
              skipped: true,
            },
            text: skipText,
          };

          const skipResult: AgentToolResult<AdvisorToolDetails> = {
            content: [{ text: skipText, type: "text" }],
            details: skipped,
            structuredContent: skipped,
          };

          if (classifierUsage) {
            skipResult.usage = classifierUsage;
          }

          return skipResult;
        }

        if (sameModelAdvisorDisabled(ctx, ctx.model, followUp?.payload.model)) {
          return skippedSameModelResult(
            _id,
            sameModelNoticeFor(followUp?.payload.model),
            reservedCalls,
            session
          );
        }

        if (
          !simpleMode &&
          !session.canConsult(getAdvisorMaxCallsPerSession(), _id)
        ) {
          throw new Error("Advisor call budget exhausted for this session.");
        }

        claimTrackedHandoff(session, params.includeTrackedFiles);

        if (!simpleMode) {
          session.consumeCall(_id);
          reservedCalls.delete(_id);
          session.resetTurnsSinceConsultation();
        }
      } catch (error) {
        session.releaseCall(_id);
        reservedCalls.delete(_id);
        throw error;
      }

      const runConsultation = async () => {
        let scoutDetails: AdvisorToolDetails["scout"];

        const coalescedUpdate = createCoalescedUpdate(
          (update: Parameters<NonNullable<typeof onUpdate>>[0]) =>
            onUpdate?.(update),
          ADVISOR_STREAM_UPDATE_INTERVAL_MS
        );

        const flushUpdate = () => {
          const result = coalescedUpdate.flush();

          if (result.failed) {
            throw result.error;
          }
        };

        const finishHerdrActivity = herdrActivity.start();

        try {
          const result = await requestAdvisor(
            ctx,
            resolveAdvisorRequest(params.question),
            signal,
            (t, tx) =>
              coalescedUpdate.update({
                content: [{ text: tx, type: "text" }],
                details: {
                  advisor: followUp?.payload.model ?? advisorRef,
                  followUp: Boolean(followUp),
                  question: resolveAdvisorRequest(params.question),
                  scout: scoutDetails,
                  text: tx,
                  thinking: t,
                },
              }),
            "executor-requested",
            // "none" is the model declining repository context for this call.
            params.gitContext === "none" ? "off" : params.gitContext,
            params.draft,
            params.includeUntracked,
            params.includeTrackedFiles,
            (event) => {
              scoutDetails = scoutDetailsFromEvent(event, scoutDetails);
              coalescedUpdate.update({
                content: [{ text: scoutDetails.text ?? "", type: "text" }],
                details: {
                  advisor: followUp?.payload.model ?? advisorRef,
                  followUp: Boolean(followUp),
                  question: resolveAdvisorRequest(params.question),
                  scout: scoutDetails,
                },
              });
            },
            _id,
            followUp,
            (adviceId, payload, replacesAdviceId) =>
              session.captureFollowUp(adviceId, payload, replacesAdviceId)
          );

          flushUpdate();
          session.issueAdvice(
            result.adviceId,
            result.markdown,
            result.trigger,
            Boolean(result.draftBytes),
            normalizedQuestion
          );
          session.recordInvocation({
            cost: advisorUsageCost(result.usage),
            executionEffect: "continued",
            followUp: result.followUp,
            kind: "markdown",
            model: result.model,
            trigger: "executor-requested",
            usage: result.usage,
          });
          const usage = snapshotAdvisorUsage(result.usage);
          const advisorPiUsage = advisorUsageForPi(result.usage);

          const piUsage = combineAdvisorAndClassifierUsage(
            advisorPiUsage,
            classifierUsage
          );

          updateAdvisorUsageStatus(ctx, session);

          const details: AdvisorToolDetails = {
            adviceId: result.adviceId,
            advisor: result.model,
            agentRulesBytes: result.agentRulesBytes,
            draftBytes: result.draftBytes,
            followUp: result.followUp,
            imageBytes: result.imageBytes,
            imageCount: result.imageCount,
            imageOmissions: result.imageOmissions,
            imagePartsSeen: result.imagePartsSeen,
            preferenceBytes: result.preferenceBytes,
            question: resolveAdvisorRequest(params.question),
            scout: scoutDetails,
            text: result.markdown,
            thinking: result.thinkingText,
            trackedBytes: result.trackedBytes,
            untrackedBytes: result.untrackedBytes,
          };

          if (usage) {
            details.usage = usage;
          }

          const structuredContent: Static<typeof advisorOutputSchema> = {
            adviceId: result.adviceId,
            advisor: result.model,
            followUp: Boolean(result.followUp),
            text: result.markdown,
          };

          if (usage) {
            structuredContent.usage = usage;
          }

          const response: AgentToolResult<AdvisorToolDetails> = {
            content: [
              {
                text: `${result.followUp ? "Advisor follow-up" : "Advisor"} (${result.model})\n\n${result.markdown}`,
                type: "text",
              },
            ],
            details,
            structuredContent,
          };

          if (piUsage) {
            response.usage = piUsage;
          }

          return response;
        } catch (error) {
          // Publish the latest partial state before surfacing a provider or
          // execution error. A failure from the UI sink must not replace the
          // original error because this path is also used for provider failures.
          coalescedUpdate.flush();

          const message =
            error instanceof Error ? error.message : String(error);

          session.recordInvocation({
            executionEffect: "continued",
            failure: "provider-error",
            kind: "markdown",
            model: followUp?.payload.model ?? advisorRef,
            trigger: "executor-requested",
          });
          updateAdvisorUsageStatus(ctx, session);
          notifyLocalFailure(ctx, message);
          notifyHerdrAdvisorFailure("Advisor consultation failed", message);
          throw error;
        } finally {
          finishHerdrActivity();
          coalescedUpdate.cancel();
        }
      };

      return runConsultation();
    },
    label: "Ask Advisor",
    name: "ask_advisor",
    outputSchema: advisorOutputSchema,
    parameters: Type.Object({
      draft: Type.Optional(
        Type.String({
          description:
            "Concise untrusted draft for plan or completion review; claims are not verification evidence.",
        })
      ),
      followUpTo: Type.Optional(
        Type.String({
          description:
            "Opaque adviceId from a prior successful consultation. Requires a new non-empty question and reuses that consultation's redacted payload; do not combine with draft, Git context, or file attachments.",
        })
      ),
      force: Type.Optional(
        Type.Boolean({
          description:
            "Set true only when you judge a decision genuinely material after a consultation was screened out; bypasses screening.",
        })
      ),
      gitContext: Type.Optional(
        Type.Union(
          [Type.Literal("none"), Type.Literal("summary"), Type.Literal("full")],
          {
            description:
              "How much of the working tree to include. Use full when the review depends on the exact code changes, such as a completion review. Use summary for changed file names only, or none when the question is not about the current changes. The user's configured allowance is the ceiling and a larger request is narrowed to it.",
          }
        )
      ),
      includeTrackedFiles: Type.Optional(
        Type.Array(
          Type.String({
            description:
              "Exact tracked repository-relative files to attach after the Advisor explicitly names a file it cannot review. Requires global advisorTrackedFileContent consent; current working-tree contents are sent as untrusted data.",
          })
        )
      ),
      includeUntracked: Type.Optional(
        Type.Array(
          Type.String({
            description:
              "Exact new repository-relative files to include only when user configuration allows it.",
          })
        )
      ),
      question: Type.Optional(
        Type.String({
          description:
            "The specific question or decision to get advice on. Omit this for normal reviews: the Advisor already has the conversation context.",
        })
      ),
    }),
    promptGuidelines: [
      "Call ask_advisor with an empty object for general consultation. For a plan or completion review, include a concise draft naming work, validation, and remaining risks; its claims are not evidence. To drill into an existing answer, pass its adviceId as followUpTo with a new question and no draft, Git context, or attachments. If the Advisor explicitly says it cannot review a specifically named file, you may make a sequential follow-up call with includeTrackedFiles when the file is relevant, permitted, and worth the shared call budget; do not infer paths or retry automatically.",
    ],
    promptSnippet:
      "Consult the Advisor using its existing context; attach a draft for plan or completion review",
    renderCall(args, theme) {
      return renderAdvisorCallBox(
        args.question?.trim(),
        theme,
        Boolean(args.followUpTo)
      );
    },
    renderResult(result, options, theme, context) {
      // SAFETY: this tool's execute() only returns AdvisorToolDetails-shaped details.
      return renderAdvisorResult(
        result as AgentToolResult<AdvisorToolDetails>,
        options,
        theme,
        context as AdvisorToolContext
      );
    },
    renderShell: "self",
  });
};
