import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendOutcome } from "../outcomes.js";
import type { AdvisorSessionState } from "../session-state.js";
import { consultAdvisor, runAdvisorGate } from "./consultation.js";
import { registerAskAdvisorTool } from "./register-ask-advisor.js";
import { registerToolLifecycle } from "./register-lifecycle.js";
import { registerOutcomeTool } from "./register-outcome.js";
import { registerToolRenderers } from "./register-renderers.js";
import { ScoutStatusManager } from "./scout-status.js";
import { advisorSessionState } from "./session.js";
import type {
  ToolRegistrationContext,
  ToolRegistrationDependencies,
} from "./types.js";

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
    session,
  };

  registerToolRenderers(pi);
  registerToolLifecycle(registration);
  registerAskAdvisorTool(registration);
  registerOutcomeTool(registration);
};
