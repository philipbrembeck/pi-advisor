import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { appendOutcome } from "../outcomes.ts";
import type { AdvisorSessionState } from "../session-state.ts";
import { consultAdvisor, runAdvisorGate } from "./consultation.ts";
import { screenConsultation } from "./jev-filter.ts";
import { registerJevTurnGate } from "./jev-turn-gate.ts";
import type { JevTurnGateRegistration } from "./jev-turn-gate.ts";
import { registerAskAdvisorTool } from "./register-ask-advisor.ts";
import { registerToolLifecycle } from "./register-lifecycle.ts";
import { registerOutcomeTool } from "./register-outcome.ts";
import { registerToolRenderers } from "./register-renderers.ts";
import { ScoutStatusManager } from "./scout-status.ts";
import { advisorSessionState } from "./session.ts";
import type {
  ToolRegistrationContext,
  ToolRegistrationDependencies,
} from "./types.ts";

export const registerAdvisorTool = (
  pi: ExtensionAPI,
  session: AdvisorSessionState = advisorSessionState,
  dependencies: ToolRegistrationDependencies = {}
): void => {
  const registration: ToolRegistrationContext = {
    appendOutcome: dependencies.appendOutcome ?? appendOutcome,
    consult: dependencies.consult ?? consultAdvisor,
    pi,
    reservedCalls: new Set<string>(),
    runGate: dependencies.runGate ?? runAdvisorGate,
    scoutStatus: dependencies.statusManager ?? new ScoutStatusManager(),
    screen: dependencies.screen ?? screenConsultation,
    session,
  };

  registerToolRenderers(pi);
  registerToolLifecycle(registration);
  registerAskAdvisorTool(registration);
  registerOutcomeTool(registration);
  const turnGate: JevTurnGateRegistration = {
    activeTools: () => pi.getActiveTools(),
    consult: registration.consult,
    send: (message) => pi.sendMessage(message, { deliverAs: "steer" }),
    session,
  };
  if (dependencies.turnGateDeps) {
    turnGate.deps = dependencies.turnGateDeps;
  }
  registerJevTurnGate((event, handler) => pi.on(event, handler), turnGate);
};
