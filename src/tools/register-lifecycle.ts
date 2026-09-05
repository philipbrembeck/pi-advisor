import {
  advisorSessionSummaryRef,
  getAdvisorMaxCallsPerSession,
  isSimpleMode,
} from "../config/state.js";
import { loadConfig } from "../config/storage.js";
import { herdrAdvisorBlock } from "../herdr.js";
import { reserveAdvisorCall } from "./gate-policy.js";
import { handleAutomaticGate } from "./loop-gate.js";
import { advisorInvocationGuidelines } from "./prompts.js";
import type { ToolRegistrationContext } from "./types.js";

export const registerToolLifecycle = ({
  pi,
  reservedCalls,
  runGate,
  scoutStatus,
  session,
}: ToolRegistrationContext): void => {
  // A throwing tool_call handler makes pi block that tool call (fail-safe), so
  // a malformed advisor.json must not escape this handler: gating is skipped
  // for that call and the failure is surfaced once per distinct outage. Config
  // errors stay an Advisor concern instead of escalating into a session-wide
  // outage.
  let lastConfigErrorNotified: string | undefined;
  const loadConfigOrSkipGating = (ctx: Parameters<typeof loadConfig>[0]) => {
    try {
      loadConfig(ctx);
      lastConfigErrorNotified = undefined;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastConfigErrorNotified) {
        lastConfigErrorNotified = message;
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Advisor gating skipped; configuration is invalid. ${message} Fix advisor.json.`,
            "error"
          );
        }
      }
      return false;
    }
  };

  pi.on("session_start", (_event, ctx) => {
    session.resetTask();
    reservedCalls.clear();
    herdrAdvisorBlock.clear();
    if (ctx?.hasUI) {
      ctx.ui.setStatus("advisor-usage", undefined);
    }
  });

  pi.on("before_agent_start", (_event, ctx) => {
    if (!pi.getActiveTools().includes("ask_advisor")) {
      return;
    }
    loadConfig(ctx);
    const guidelines = advisorInvocationGuidelines();
    const budget = isSimpleMode()
      ? undefined
      : session.remainingCalls(getAdvisorMaxCallsPerSession());
    if (budget !== undefined) {
      guidelines.push(
        `Advisor calls remaining this session: ${budget}.\nReserve calls for material decisions, repeated failures, or final review.`
      );
    }
    return guidelines.length > 0
      ? {
          systemPrompt: `${ctx.getSystemPrompt()}\n\nAdvisor invocation settings:\n${guidelines.map((rule) => `- ${rule}`).join("\n")}`,
        }
      : undefined;
  });

  pi.on("tool_call", (event, ctx) => {
    if (session.blocked) {
      return {
        block: true,
        reason: session.blockedReason ?? "Advisor session is blocked.",
      };
    }
    if (!pi.getActiveTools().includes("ask_advisor")) {
      return;
    }
    if (!loadConfigOrSkipGating(ctx)) {
      // The ask_advisor execute path surfaces its own configuration errors as
      // tool errors; every other tool must proceed without Advisor gating.
      return;
    }
    const reservation = reserveAdvisorCall(event, ctx, session, reservedCalls);
    if (event.toolName === "ask_advisor") {
      return reservation;
    }
    return handleAutomaticGate(pi, event, ctx, session, runGate, scoutStatus);
  });

  pi.on("agent_settled", (_event, ctx) => {
    // Any reservation still present never reached execute (for example because
    // another handler blocked it or the turn was aborted).
    reservedCalls.clear();
    if (isSimpleMode() || session.blocked || !advisorSessionSummaryRef) {
      return;
    }
    const summary = session.summary(getAdvisorMaxCallsPerSession());
    if (summary && ctx.hasUI) {
      ctx.ui.notify(summary, "info");
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    reservedCalls.clear();
    scoutStatus.clear(ctx);
    herdrAdvisorBlock.clear();
    if (ctx?.hasUI) {
      ctx.ui.setStatus("advisor-usage", undefined);
    }
  });
};
