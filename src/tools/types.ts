import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { HerdrAdvisorActivityScope, HerdrAdvisorBlock } from "../herdr.ts";
import type { appendOutcome } from "../outcomes.ts";
import type { ScoutOutcome } from "../scout.ts";
import type {
  AdvisorSessionState,
  ConsultationTrigger,
  GateDecision,
  GateTrigger,
} from "../session-state.ts";
import type { consultAdvisor, runAdvisorGate } from "./consultation.ts";
import type { JevSkipKind, screenConsultation } from "./jev-filter.ts";
import type { JevTurnGateDeps } from "./jev-turn-gate.ts";
import type { ScoutStatusManager } from "./scout-status.ts";

export type {
  AdvisorInvocationRecord,
  ConsultationTrigger,
  GateDecision,
  GateTrigger,
} from "../session-state.ts";

export interface ScoutToolDetails {
  availableCount?: number;
  fallbackReason?: string;
  latencyMs?: number;
  model: string;
  omittedBeforeScout?: number;
  selectedCount?: number;
  selectedLabels?: string[];
  status: "calling" | "streaming" | "curated" | "fallback" | "cancelled";
  synthesis?: string;
  text?: string;
  thinking?: string;
  usage?: unknown;
}

export interface AdvisorGateFailure {
  category: GateFailureCategory;
  markdown?: string;
  message: string;
  ok: false;
  usage?: unknown;
}

export interface AdvisorConsultationResult {
  adviceId: string;
  draftBytes?: number;
  markdown: string;
  model: string;
  preferenceBytes?: number;
  scout?: Exclude<ScoutOutcome, { cancelled: true }>;
  thinkingText: string;
  trackedBytes?: number;
  trigger: ConsultationTrigger;
  untrackedBytes?: number;
  usage?: unknown;
}

export interface AdvisorGateResult {
  decision: GateDecision;
  markdown: string;
  model: string;
  ok: true;
  thinkingText: string;
  trigger: GateTrigger;
  usage?: unknown;
}

export type AdvisorGateOutcome = AdvisorGateResult | AdvisorGateFailure;

export type GateFailureCategory =
  | "provider-error"
  | "empty-response"
  | "missing-decision"
  | "malformed-decision"
  | "duplicate-decision"
  | "contradictory-decision"
  | "budget-exhausted";

export interface AdvisorToolDetails {
  adviceId?: string;
  advisor?: string;
  draftBytes?: number;
  jev?: {
    kind: JevSkipKind;
    reason: string;
    skipped: boolean;
  };
  preferenceBytes?: number;
  question?: string;
  scout?: ScoutToolDetails;
  text?: string;
  thinking?: string;
  trackedBytes?: number;
  untrackedBytes?: number;
  usage?: unknown;
}

interface AdvisorRenderState {
  phase?: string;
  scout?: ScoutToolDetails;
  timerId?: ReturnType<typeof setInterval>;
}

export interface AdvisorToolContext {
  invalidate: () => void;
  lastComponent: unknown;
  state: AdvisorRenderState;
}

export interface ToolRegistrationContext {
  appendOutcome: typeof appendOutcome;
  consult: typeof consultAdvisor;
  herdrActivity: HerdrAdvisorActivityScope;
  herdrBlock: HerdrAdvisorBlock;
  pi: ExtensionAPI;
  reservedCalls: Set<string>;
  runGate: typeof runAdvisorGate;
  scoutStatus: ScoutStatusManager;
  screen: typeof screenConsultation;
  session: AdvisorSessionState;
}

export interface ToolRegistrationDependencies {
  appendOutcome?: typeof appendOutcome;
  consult?: typeof consultAdvisor;
  herdrActivity?: HerdrAdvisorActivityScope;
  herdrBlock?: HerdrAdvisorBlock;
  runGate?: typeof runAdvisorGate;
  screen?: typeof screenConsultation;
  statusManager?: ScoutStatusManager;
  turnGateDeps?: JevTurnGateDeps;
}
