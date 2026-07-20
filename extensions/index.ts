import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "../src/commands.js";
import { registerAdvisorTool } from "../src/tools.js";

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
export {
  consultAdvisor,
  parseAutomaticDecision,
  runAdvisorGate,
} from "../src/tools.js";

export default function (pi: ExtensionAPI) {
  registerAdvisorTool(pi);
  registerCommands(pi);
}
