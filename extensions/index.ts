import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "../src/commands.js";
import {
  consultAdvisor as consultAdvisorImplementation,
  parseAutomaticDecision as parseAutomaticDecisionImplementation,
  registerAdvisorTool,
  runAdvisorGate as runAdvisorGateImplementation,
} from "../src/tools.js";

export type { AdvisorConfig, GateFailureMode } from "../src/config.js";
export type {
  AdvisorConsultationResult,
  AdvisorGateFailure,
  AdvisorGateOutcome,
  AdvisorGateResult,
  ConsultationTrigger,
  GateDecision,
  GateTrigger,
} from "../src/tools.js";
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
  registerAdvisorTool(pi);
  registerCommands(pi);
}
