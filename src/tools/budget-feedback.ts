import type {
  ExtensionAPI,
  ExtensionContext,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

import {
  advisorToolsEnabledRef,
  getAdvisorMaxCallsPerSession,
  isSimpleMode,
} from "../config/state.ts";
import { loadConfig } from "../config/storage.ts";
import type { AdvisorSessionState } from "../session-state.ts";
import { advisorModelIsAllowed } from "./model-access.ts";

export const advisorBudgetMessage = (session: AdvisorSessionState) => {
  const simple = isSimpleMode();

  const remaining = simple
    ? undefined
    : session.remainingCalls(getAdvisorMaxCallsPerSession());

  return {
    content: [
      `Advisor calls remaining this session: ${remaining ?? "unlimited"}.`,
      simple ? "Call budgets are disabled in Simple mode." : undefined,
      "This is the current available allowance after consumed and reserved calls. Do not subtract earlier consultations again; this report supersedes earlier budget reports.",
    ]
      .filter(Boolean)
      .join("\n"),
    customType: "advisor-budget",
    display: false,
  };
};

export const advisorBudgetUpdate = (
  event: TurnEndEvent,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  session: AdvisorSessionState
) => {
  if (!pi.getActiveTools().includes("ask_advisor")) {
    return;
  }

  try {
    loadConfig(ctx);
  } catch {
    return;
  }

  if (!advisorToolsEnabledRef || !advisorModelIsAllowed(ctx)) {
    return;
  }

  const message = advisorBudgetMessage(session);

  const previous = event.context?.contextMessages.findLast(
    (entry) => entry.role === "custom" && entry.customType === "advisor-budget"
  );

  if (previous?.role === "custom" && previous.content === message.content) {
    return;
  }

  return {
    entries: [{ ...message, type: "custom_message" as const }],
  };
};
