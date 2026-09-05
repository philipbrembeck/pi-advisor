// biome-ignore lint/performance/noBarrelFile: this facade intentionally preserves the public tools module contract.
export {
  consultAdvisor,
  curateAdvisorConversation,
  runAdvisorGate,
} from "./tools/consultation.js";
export { gateFailureEffectForMode } from "./tools/gate-policy.js";
export { parseAutomaticDecision } from "./tools/gate-protocol.js";
export {
  ADVISOR_DECISION_SYSTEM,
  ADVISOR_SYSTEM,
  advisorGitContextBudget,
  advisorInvocationGuidelines,
  advisorMessageText,
  advisorRepositoryContext,
  advisorRequestConversation,
  gitContextNote,
} from "./tools/prompts.js";
export { registerAdvisorTool } from "./tools/registration.js";
export {
  adviceForDisplay,
  hasSoundVerdict,
  renderAdvisorCallBox,
  renderAdvisorResponseHeader,
  renderThinkingMarkdown,
  resolveAdvisorRequest,
  SPINNER_FRAMES,
} from "./tools/render-common.js";
export {
  appendScoutLifecycleEntry,
  renderScoutDetails,
  ScoutStatusManager,
  scoutDetailsFromEvent,
} from "./tools/scout-status.js";
export { advisorSessionState } from "./tools/session.js";
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
} from "./tools/types.js";
