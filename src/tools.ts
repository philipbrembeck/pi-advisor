// biome-ignore lint/performance/noBarrelFile: this facade intentionally preserves the public tools module contract.
export {
  consultAdvisor,
  curateAdvisorConversation,
  runAdvisorGate,
} from "./tools/consultation.ts";
export { gateFailureEffectForMode } from "./tools/gate-policy.ts";
export { parseAutomaticDecision } from "./tools/gate-protocol.ts";
export {
  ADVISOR_DECISION_SYSTEM,
  ADVISOR_SYSTEM,
  advisorGitContextBudget,
  advisorInvocationGuidelines,
  advisorMessageText,
  advisorRepositoryContext,
  advisorRequestConversation,
  gitContextNote,
} from "./tools/prompts.ts";
export { registerAdvisorTool } from "./tools/registration.ts";
export {
  adviceForDisplay,
  hasSoundVerdict,
  renderAdvisorCallBox,
  renderAdvisorResponseHeader,
  renderThinkingMarkdown,
  resolveAdvisorRequest,
  SPINNER_FRAMES,
} from "./tools/render-common.ts";
export {
  appendScoutLifecycleEntry,
  renderScoutDetails,
  ScoutStatusManager,
  scoutDetailsFromEvent,
} from "./tools/scout-status.ts";
export { advisorSessionState } from "./tools/session.ts";
export type {
  AdvisorConsultationResult,
  AdvisorGateFailure,
  AdvisorGateOutcome,
  AdvisorGateResult,
  AdvisorInvocationRecord,
  ConsultationTrigger,
  GateDecision,
  GateFailureCategory,
  GateTrigger,
  ScoutToolDetails,
} from "./tools/types.ts";
