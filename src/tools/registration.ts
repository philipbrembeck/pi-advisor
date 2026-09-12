import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendOutcome } from "../outcomes.ts";
import type { AdvisorSessionState } from "../session-state.ts";
import { consultAdvisor, runAdvisorGate } from "./consultation.ts";
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
    session,
  };

  registerToolRenderers(pi);
  registerToolLifecycle(registration);
  registerAskAdvisorTool(registration);
  registerOutcomeTool(registration);
};
