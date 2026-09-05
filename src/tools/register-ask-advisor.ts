import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  advisorRef,
  getAdvisorMaxCallsPerSession,
  isSimpleMode,
} from "../config/state.js";
import { herdrAdvisorActivity, notifyHerdrAdvisorFailure } from "../herdr.js";
import {
  ADVISOR_STREAM_UPDATE_INTERVAL_MS,
  createCoalescedUpdate,
} from "../model-stream.js";
import {
  advisorUsageCost,
  advisorUsageForPi,
  snapshotAdvisorUsage,
} from "../usage.js";
import { notifyLocalFailure, updateAdvisorUsageStatus } from "./gate-policy.js";
import { renderAdvisorResult } from "./render-advisor-result.js";
import {
  renderAdvisorCallBox,
  resolveAdvisorRequest,
} from "./render-common.js";
import { scoutDetailsFromEvent } from "./scout-status.js";
import type {
  AdvisorToolContext,
  AdvisorToolDetails,
  ToolRegistrationContext,
} from "./types.js";

export const registerAskAdvisorTool = ({
  consult: requestAdvisor,
  pi,
  reservedCalls,
  session,
}: ToolRegistrationContext): void => {
  pi.registerTool({
    description:
      "Consult the on-demand Advisor model for strategic guidance. Call with an empty object for a contextual review; attach an optional draft for concrete plan or completion review. If the Advisor explicitly names a missing file, you may make a sequential follow-up call with includeTrackedFiles when enabled and relevant.",
    async execute(_id, params, signal, onUpdate, ctx) {
      reservedCalls.delete(_id);
      if (
        params.includeTrackedFiles?.length &&
        !session.claimTrackedFiles(params.includeTrackedFiles)
      ) {
        throw new Error(
          "Tracked file handoff requires a prior Advisor response that explicitly names every requested path and is consumed once."
        );
      }
      if (!isSimpleMode()) {
        if (!session.canConsult(getAdvisorMaxCallsPerSession())) {
          throw new Error("Advisor call budget exhausted for this session.");
        }
        session.consumeCall();
      }
      herdrAdvisorActivity.start();
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
      try {
        const result = await requestAdvisor(
          ctx,
          resolveAdvisorRequest(params.question),
          signal,
          (t, tx) =>
            coalescedUpdate.update({
              content: [{ text: tx, type: "text" }],
              details: {
                advisor: advisorRef,
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
                advisor: advisorRef,
                question: resolveAdvisorRequest(params.question),
                scout: scoutDetails,
              },
            });
          },
          _id
        );
        flushUpdate();
        session.issueAdvice(
          result.adviceId,
          result.markdown,
          result.trigger,
          Boolean(result.draftBytes)
        );
        session.recordInvocation({
          cost: advisorUsageCost(result.usage),
          executionEffect: "continued",
          kind: "markdown",
          model: result.model,
          trigger: "executor-requested",
          usage: result.usage,
        });
        const usage = snapshotAdvisorUsage(result.usage);
        const piUsage = advisorUsageForPi(result.usage);
        updateAdvisorUsageStatus(ctx, session);
        return {
          content: [
            {
              text: `Advisor (${result.model})\n\n${result.markdown}`,
              type: "text",
            },
          ],
          details: {
            adviceId: result.adviceId,
            advisor: result.model,
            draftBytes: result.draftBytes,
            preferenceBytes: result.preferenceBytes,
            question: resolveAdvisorRequest(params.question),
            scout: scoutDetails,
            text: result.markdown,
            thinking: result.thinkingText,
            trackedBytes: result.trackedBytes,
            untrackedBytes: result.untrackedBytes,
            ...(usage ? { usage } : {}),
          },
          ...(piUsage ? { usage: piUsage } : {}),
        };
      } catch (error) {
        // Publish the latest partial state before surfacing a provider or
        // execution error. A failure from the UI sink must not replace the
        // original error because this path is also used for provider failures.
        coalescedUpdate.flush();
        const message = error instanceof Error ? error.message : String(error);
        session.recordInvocation({
          executionEffect: "continued",
          failure: "provider-error",
          kind: "markdown",
          model: advisorRef,
          trigger: "executor-requested",
        });
        updateAdvisorUsageStatus(ctx, session);
        notifyLocalFailure(ctx, message);
        notifyHerdrAdvisorFailure("Advisor consultation failed", message);
        throw error;
      } finally {
        coalescedUpdate.cancel();
        herdrAdvisorActivity.finish();
      }
    },
    label: "Ask Advisor",
    name: "ask_advisor",
    parameters: Type.Object({
      draft: Type.Optional(
        Type.String({
          description:
            "Concise untrusted draft for plan or completion review; claims are not verification evidence.",
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
      "Call ask_advisor with an empty object for general consultation. For a plan or completion review, include a concise draft naming work, validation, and remaining risks; its claims are not evidence. If the Advisor explicitly says it cannot review a specifically named file, you may make a sequential follow-up call with includeTrackedFiles when the file is relevant, permitted, and worth the shared call budget; do not infer paths or retry automatically.",
    ],
    promptSnippet:
      "Consult the Advisor using its existing context; attach a draft for plan or completion review",
    renderCall(args, theme) {
      return renderAdvisorCallBox(args.question?.trim(), theme);
    },
    renderResult(result, options, theme, context) {
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
