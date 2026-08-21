import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "../src/commands.js";
import { setHerdrBlockedEmitter } from "../src/herdr.js";
import { AdvisorSessionState } from "../src/session-state.js";
import { createBenchmarkTelemetry } from "../src/telemetry.js";
import {
  consultAdvisor as consultAdvisorImplementation,
  parseAutomaticDecision as parseAutomaticDecisionImplementation,
  registerAdvisorTool,
  runAdvisorGate as runAdvisorGateImplementation,
  ScoutStatusManager,
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
  const sessionState = new AdvisorSessionState();
  const scoutStatus = new ScoutStatusManager();
  setHerdrBlockedEmitter((active, label) =>
    pi.events.emit("herdr:blocked", { active, label })
  );
  const benchmarkTelemetry = createBenchmarkTelemetry(pi.events);
  if (benchmarkTelemetry) {
    // Diagnostics only: never rewrite provider payloads or affect production sessions.
    pi.on("before_provider_request", (event) => {
      benchmarkTelemetry.providerRequest(event.payload);
    });
  }
  registerAdvisorTool(pi, sessionState, {
    statusManager: scoutStatus,
    telemetry: benchmarkTelemetry,
  });
  registerCommands(pi, {
    sessionState,
    statusManager: scoutStatus,
    telemetry: benchmarkTelemetry,
  });
}
