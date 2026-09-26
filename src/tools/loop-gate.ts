import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import {
  advisorAutoLoopGateRef,
  advisorFailureModeRef,
  advisorLoopThresholdRef,
  advisorRef,
  advisorScoutEnabledRef,
  getAdvisorMaxCallsPerSession,
  isSimpleMode,
} from "../config/state.ts";
import type { GateFailureMode } from "../config/types.ts";
import { herdrAdvisorActivity, herdrAdvisorBlock } from "../herdr.ts";
import type { HerdrAdvisorActivityScope, HerdrAdvisorBlock } from "../herdr.ts";
import type { AdvisorSessionState, GateDecision } from "../session-state.ts";
import { advisorUsageCost, snapshotAdvisorUsage } from "../usage.ts";
import type { AdvisorUsageSnapshot } from "../usage.ts";
import type { runAdvisorGate } from "./consultation.ts";
import {
  blockedDecisionEffect,
  failureEffect,
  gateDecisionEffect,
  gateFailureEffectForMode,
  updateAdvisorUsageStatus,
} from "./gate-policy.ts";
import { adviceForGateText } from "./gate-protocol.ts";
import { advisorModelIsAllowed } from "./model-access.ts";
import { appendScoutLifecycleEntry } from "./scout-status.ts";
import type { ScoutStatusManager } from "./scout-status.ts";
import type { AdvisorGateResult, ScoutToolDetails } from "./types.ts";

const sendAutomaticGateCall = (pi: ExtensionAPI, event: ToolCallEvent) => {
  pi.sendMessage(
    {
      content: "Automatic Advisor loop review",
      customType: "advisor-loop-call",
      details: {
        question: `Loop gate: ${event.toolName} repeated ${advisorLoopThresholdRef} times`,
      },
      display: true,
    },
    { deliverAs: "steer" }
  );
};

interface LoopResultDetails {
  advisor?: string;
  decision?: GateDecision;
  text: string;
  usage?: AdvisorUsageSnapshot;
}

const sendAutomaticGateFailure = (
  pi: ExtensionAPI,
  markdown: string,
  usage?: AdvisorUsageSnapshot
) => {
  const details: LoopResultDetails = { text: markdown };
  if (usage) {
    details.usage = usage;
  }
  pi.sendMessage(
    {
      content: markdown,
      customType: "advisor-loop-result",
      details,
      display: true,
    },
    { deliverAs: "steer" }
  );
};

const sendAutomaticGateResult = (
  pi: ExtensionAPI,
  result: AdvisorGateResult
) => {
  const details: LoopResultDetails = {
    advisor: result.model,
    decision: result.decision,
    text: result.markdown,
  };
  const normalizedUsage = snapshotAdvisorUsage(result.usage);
  if (normalizedUsage) {
    details.usage = normalizedUsage;
  }
  pi.sendMessage(
    {
      content: adviceForGateText(result),
      customType: "advisor-loop-result",
      details,
      display: true,
    },
    { deliverAs: "steer" }
  );
};

/** Records the invocation, reports it, and maps the gate decision to its
 * tool-call result (block reason or proceed). */
const applyGateDecision = (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  session: AdvisorSessionState,
  result: Awaited<ReturnType<typeof runAdvisorGate>>,
  reason: string,
  failureMode: GateFailureMode,
  herdrBlock: HerdrAdvisorBlock
): ToolCallEventResult | undefined => {
  if (!result.ok) {
    session.recordInvocation({
      executionEffect: gateFailureEffectForMode(failureMode),
      failure: result.category,
      kind: "gate",
      model: advisorRef,
      trigger: "repeated-tool-call",
      usage: result.usage,
    });
    updateAdvisorUsageStatus(ctx, session);
    const failure = failureEffect(
      result.category,
      result.message,
      ctx,
      session,
      failureMode,
      herdrBlock
    );
    sendAutomaticGateFailure(
      pi,
      `**Advisor gate failure (${result.category}):** ${result.message}`,
      snapshotAdvisorUsage(result.usage)
    );
    return failure.block
      ? { block: true, reason: `${reason}\n${failure.reason}` }
      : undefined;
  }
  session.recordInvocation({
    cost: advisorUsageCost(result.usage),
    decision: result.decision,
    executionEffect: gateDecisionEffect(result.decision, failureMode),
    kind: "gate",
    model: result.model,
    trigger: result.trigger,
    usage: result.usage,
  });
  updateAdvisorUsageStatus(ctx, session);
  sendAutomaticGateResult(pi, result);
  if (result.decision === "proceed") {
    session.resetRepetition();
    return;
  }
  const gateReason = `Advisor loop review: ${result.markdown}`;
  if (result.decision === "blocked") {
    const effect = blockedDecisionEffect(
      gateReason,
      ctx,
      session,
      failureMode,
      herdrBlock
    );
    return effect.block ? { block: true, reason: effect.reason } : undefined;
  }
  return { block: true, reason: gateReason };
};

export const handleAutomaticGate = async (
  pi: ExtensionAPI,
  event: ToolCallEvent,
  ctx: ExtensionContext,
  session: AdvisorSessionState,
  runGate: typeof runAdvisorGate,
  scoutStatus: ScoutStatusManager,
  herdrActivity: HerdrAdvisorActivityScope = herdrAdvisorActivity,
  herdrBlock: HerdrAdvisorBlock = herdrAdvisorBlock
): Promise<ToolCallEventResult | undefined> => {
  if (
    isSimpleMode() ||
    event.toolName === "ask_advisor" ||
    !advisorModelIsAllowed(ctx) ||
    !advisorAutoLoopGateRef ||
    !session.recordToolCall(
      event.toolName,
      event.input,
      advisorLoopThresholdRef
    )
  ) {
    return;
  }
  const reason = `Advisor loop gate: normalized signature for ${event.toolName} repeated ${advisorLoopThresholdRef} times without a materially different tool action.`;
  const failureMode = advisorFailureModeRef;
  if (!session.canConsult(getAdvisorMaxCallsPerSession())) {
    const failure = failureEffect(
      "budget-exhausted",
      "Advisor gate call budget is exhausted.",
      ctx,
      session,
      failureMode,
      herdrBlock
    );
    return failure.block ? { block: true, reason: failure.reason } : undefined;
  }
  session.consumeCall();
  session.resetTurnsSinceConsultation();
  const finishHerdrActivity = herdrActivity.start();
  let scoutDetails: ScoutToolDetails | undefined;
  const scoutStatusToken = Symbol("automatic-gate-scout");
  scoutStatus.register(scoutStatusToken);
  let gateCallSent = false;
  const ensureGateCall = () => {
    if (!gateCallSent) {
      sendAutomaticGateCall(pi, event);
      gateCallSent = true;
    }
  };
  try {
    if (!advisorScoutEnabledRef) {
      ensureGateCall();
    }
    const result = await runGate(
      ctx,
      `${reason} Review the repeated actions and recommend the smallest safe next step.`,
      "repeated-tool-call",
      ctx.signal,
      undefined,
      (scoutEvent) => {
        scoutStatus.update(ctx, scoutStatusToken, scoutEvent);
        scoutDetails = appendScoutLifecycleEntry(pi, scoutEvent, scoutDetails);
        if (scoutEvent.type === "success" || scoutEvent.type === "fallback") {
          ensureGateCall();
        }
      },
      event.toolCallId
    );
    ensureGateCall();
    return applyGateDecision(
      pi,
      ctx,
      session,
      result,
      reason,
      failureMode,
      herdrBlock
    );
  } finally {
    finishHerdrActivity();
    scoutStatus.release(ctx, scoutStatusToken);
  }
};
