import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { advisorRef } from "../config/state.ts";
import { isString } from "../content-utils.ts";
import type { GitContextLevel } from "../git.ts";
import { herdrAdvisorActivity, notifyHerdrAdvisorFailure } from "../herdr.ts";
import { normalizeScreeningQuestion } from "../tools/jev-filter.ts";
import { appendScoutLifecycleEntry } from "../tools/scout-status.ts";
import type { ScoutToolDetails } from "../tools/types.ts";
import { advisorUsageCost, snapshotAdvisorUsage } from "../usage.ts";
import type { AdvisorUsageSnapshot } from "../usage.ts";
import { notify } from "./runtime.ts";
import type { CommandRuntime, ManualAdvisorProgressState } from "./types.ts";

interface ManualResultDetails {
  advisor: string;
  question?: string;
  text: string;
  usage?: AdvisorUsageSnapshot;
}

export const startManualConsultation = async (
  runtime: CommandRuntime,
  ctx: ExtensionContext,
  question: string | undefined,
  controller: AbortController,
  scoutStatusToken: symbol,
  progress: ManualAdvisorProgressState,
  gitContext?: GitContextLevel
) => {
  herdrAdvisorActivity.start();
  progress.phase = "preparing";
  runtime.requestManualRender(ctx);
  if (ctx.hasUI) {
    const timer = setInterval(() => {
      if (
        controller.signal.aborted ||
        runtime.manualConsultations.get(controller) !== scoutStatusToken
      ) {
        clearInterval(timer);
        return;
      }
      runtime.requestManualRender(ctx);
    }, 80);
    runtime.manualProgressTimers.set(controller, timer);
  }
  let scoutDetails: ScoutToolDetails | undefined;
  try {
    const { adviceId, markdown, usage } = await runtime.requestAdvisor(
      ctx,
      question,
      controller.signal,
      (thinking, text) => {
        if (controller.signal.aborted) {
          return;
        }
        progress.phase = "active";
        progress.thinking = thinking;
        progress.text = text;
        runtime.requestManualRender(ctx);
      },
      (event) => {
        if (!controller.signal.aborted) {
          runtime.scoutStatus.update(ctx, scoutStatusToken, event);
          scoutDetails = appendScoutLifecycleEntry(
            runtime.pi,
            event,
            scoutDetails
          );
          progress.scout = scoutDetails;
          progress.phase = "active";
          runtime.requestManualRender(ctx);
        }
      },
      gitContext
    );
    if (controller.signal.aborted) {
      return;
    }
    progress.phase = "complete";
    runtime.advisorSessionState.resetTurnsSinceConsultation();
    runtime.advisorSessionState.recordInvocation({
      cost: advisorUsageCost(usage),
      executionEffect: "continued",
      kind: "markdown",
      model: advisorRef,
      trigger: "manual",
      usage,
    });
    if (isString(adviceId)) {
      // Registering the manual question lets an identical later ask_advisor
      // hit repeat detection instead of re-consulting.
      runtime.advisorSessionState.issueAdvice(
        adviceId,
        markdown,
        "manual",
        false,
        normalizeScreeningQuestion(question)
      );
    }
    runtime.updateAdvisorUsageStatus(ctx);
    const details: ManualResultDetails = {
      advisor: advisorRef,
      question,
      text: markdown,
    };
    const normalizedUsage = snapshotAdvisorUsage(usage);
    if (normalizedUsage) {
      details.usage = normalizedUsage;
    }
    runtime.pi.sendMessage(
      {
        content: `Manual Advisor consultation${question ? ` (${question})` : ""} — for your awareness; no action or follow-up consultation is needed unless the user asks:\n\n${markdown}`,
        customType: "advisor-manual-result",
        details,
        display: true,
      },
      {
        // Steer lets the current turn finish its active work; the Executor sees
        // the result before its next model call rather than being interrupted.
        deliverAs: "steer",
        triggerTurn: true,
      }
    );
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    progress.phase = "error";
    const message = error instanceof Error ? error.message : String(error);
    runtime.advisorSessionState.resetTurnsSinceConsultation();
    runtime.advisorSessionState.recordInvocation({
      executionEffect: "continued",
      failure: "provider-error",
      kind: "markdown",
      model: advisorRef,
      trigger: "manual",
    });
    runtime.updateAdvisorUsageStatus(ctx);
    runtime.pi.sendMessage(
      {
        content: `Manual Advisor consultation failed: ${message}`,
        customType: "advisor-manual-result",
        details: {
          advisor: advisorRef,
          text: `**Advisor consultation failed:** ${message}`,
        },
        display: true,
      },
      { deliverAs: "steer", triggerTurn: true }
    );
    notify(ctx, `Advisor consultation failed: ${message}`, "error");
    notifyHerdrAdvisorFailure("Advisor consultation failed", message);
  } finally {
    if (controller.signal.aborted) {
      progress.phase = "cancelled";
    }
    const timer = runtime.manualProgressTimers.get(controller);
    if (timer) {
      clearInterval(timer);
      runtime.manualProgressTimers.delete(controller);
    }
    runtime.requestManualRender(ctx);
    runtime.scoutStatus.release(ctx, scoutStatusToken);
    runtime.manualConsultations.delete(controller);
    herdrAdvisorActivity.finish();
  }
};
