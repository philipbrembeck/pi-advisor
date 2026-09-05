import type {
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import {
  advisorBlockOnBlockedRef,
  getAdvisorMaxCallsPerSession,
  getAdvisorSettings,
  isSimpleMode,
} from "../config/state.js";
import type { GateFailureMode } from "../config/types.js";
import { herdrAdvisorBlock, notifyHerdrAdvisorFailure } from "../herdr.js";
import type { AdvisorSessionState } from "../session-state.js";
import type { AdvisorGateResult, GateFailureCategory } from "./types.js";

export const updateAdvisorUsageStatus = (
  ctx: ExtensionContext,
  session: AdvisorSessionState
) => {
  if (ctx.hasUI) {
    ctx.ui.setStatus(
      "advisor-usage",
      getAdvisorSettings().showUsageFooter ? session.usageStatus() : undefined
    );
  }
};

export const notifyLocalFailure = (
  ctx: ExtensionContext,
  message: string,
  sessionBlocked = false
) => {
  if (ctx.hasUI) {
    ctx.ui.notify(
      `Advisor ${sessionBlocked ? "gate failure; session blocked" : "consultation failed"}: ${message}`,
      "error"
    );
  }
};

export const gateFailureEffectForMode = (mode: GateFailureMode) => {
  if (mode === "warn-and-continue") {
    return "continued" as const;
  }
  return mode === "block-tool"
    ? ("tool-blocked" as const)
    : ("session-blocked" as const);
};

export const gateDecisionEffect = (
  decision: AdvisorGateResult["decision"],
  failureMode: GateFailureMode
) => {
  if (decision === "proceed") {
    return "continued" as const;
  }
  return decision === "blocked"
    ? gateFailureEffectForMode(failureMode)
    : ("tool-blocked" as const);
};

export const failureEffect = (
  category: GateFailureCategory,
  message: string,
  ctx: ExtensionContext,
  session: AdvisorSessionState,
  failureMode: GateFailureMode
) => {
  const reason = `Advisor gate ${category}: ${message}`;
  notifyLocalFailure(ctx, message, failureMode === "block-session");
  notifyHerdrAdvisorFailure("Advisor gate failure", reason);
  if (failureMode === "warn-and-continue") {
    return { block: false, effect: "continued" as const, reason };
  }
  if (failureMode === "block-tool") {
    return { block: true, effect: "tool-blocked" as const, reason };
  }
  session.block(reason);
  herdrAdvisorBlock.set(reason);
  if (advisorBlockOnBlockedRef) {
    ctx.abort();
  }
  return { block: true, effect: "session-blocked" as const, reason };
};

export const blockedDecisionEffect = (
  reason: string,
  ctx: ExtensionContext,
  session: AdvisorSessionState,
  failureMode: GateFailureMode
) => {
  if (failureMode === "warn-and-continue") {
    if (ctx.hasUI) {
      ctx.ui.notify(
        "Advisor gate returned blocked; continuing by configuration.",
        "warning"
      );
    }
    return { block: false, effect: "continued" as const, reason };
  }
  if (failureMode === "block-tool") {
    return { block: true, effect: "tool-blocked" as const, reason };
  }
  session.block(reason);
  herdrAdvisorBlock.set(reason);
  if (advisorBlockOnBlockedRef) {
    ctx.abort();
  }
  return { block: true, effect: "session-blocked" as const, reason };
};

export const reserveAdvisorCall = (
  event: ToolCallEvent,
  ctx: ExtensionContext,
  session: AdvisorSessionState,
  reservedCalls: Set<string>
): ToolCallEventResult | undefined => {
  if (event.toolName !== "ask_advisor" || isSimpleMode()) {
    return;
  }
  if (!session.canConsult(getAdvisorMaxCallsPerSession())) {
    const message = "Advisor call budget exhausted for this session.";
    if (ctx.hasUI) {
      ctx.ui.notify(message, "warning");
    }
    notifyHerdrAdvisorFailure("Advisor budget exhausted", message);
    return { block: true, reason: message };
  }
  reservedCalls.add(event.toolCallId);
  return {};
};
