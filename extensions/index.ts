import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "../src/commands/registration.ts";
import { setHerdrBlockedEmitter } from "../src/herdr.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import {
  consultAdvisor as consultAdvisorImplementation,
  runAdvisorGate as runAdvisorGateImplementation,
} from "../src/tools/consultation.ts";
import { parseAutomaticDecision as parseAutomaticDecisionImplementation } from "../src/tools/gate-protocol.ts";
import { registerAdvisorTool } from "../src/tools/registration.ts";
import { ScoutStatusManager } from "../src/tools/scout-status.ts";

export type { AdvisorConfig, GateFailureMode } from "../src/config/types.ts";
export type {
  AdvisorConsultationResult,
  AdvisorGateFailure,
  AdvisorGateOutcome,
  AdvisorGateResult,
  ConsultationTrigger,
  GateDecision,
  GateTrigger,
} from "../src/tools/types.ts";
export const consultAdvisor = (
  ...args: Parameters<typeof consultAdvisorImplementation>
) => consultAdvisorImplementation(...args);
export const parseAutomaticDecision = (
  ...args: Parameters<typeof parseAutomaticDecisionImplementation>
) => parseAutomaticDecisionImplementation(...args);
export const runAdvisorGate = (
  ...args: Parameters<typeof runAdvisorGateImplementation>
) => runAdvisorGateImplementation(...args);

export default function (pi: ExtensionAPI) {
  const sessionState = new AdvisorSessionState();
  const scoutStatus = new ScoutStatusManager();
  setHerdrBlockedEmitter((active, label) =>
    pi.events.emit("herdr:blocked", { active, label })
  );
  registerAdvisorTool(pi, sessionState, {
    statusManager: scoutStatus,
  });
  registerCommands(pi, {
    sessionState,
    statusManager: scoutStatus,
  });
}
