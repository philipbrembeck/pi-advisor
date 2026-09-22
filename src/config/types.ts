import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import type { GitContextLevel } from "../git.ts";

export const DEFAULT_CONTEXT_MAX_CHARS = 15_000;
export const MAX_CONTEXT_MAX_CHARS = Number.MAX_SAFE_INTEGER;
export const DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES = DEFAULT_MAX_LINES;
export const DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES = DEFAULT_MAX_BYTES;
export const DEFAULT_ADVISOR_GIT_CONTEXT_MAX_CHARS = 20_000;
export const DEFAULT_JEV_MODEL = "jev-latest";
// Provisional: the latency benchmark was dropped from scope; revisit if live
// measurements suggest a different bound.
export const DEFAULT_JEV_TIMEOUT_MS = 8000;
export const DEFAULT_JEV_DIGEST_MAX_CHARS = 4000;
export const DEFAULT_JEV_PRICE_PER_MTOK = 0.042;
export const DEFAULT_JEV_FILTER_SKIP_CONFIDENCE = 0.85;
export const DEFAULT_JEV_FILTER_NOUL_MARGIN = 0.35;
export const DEFAULT_JEV_FILTER_OVERRIDE_WINDOW = 10;
export const DEFAULT_JEV_TURN_GATE_EVERY_TURNS = 0;
export const DEFAULT_JEV_TURN_GATE_NOUL_THRESHOLD = 0.8;
export type JevTransport = "auto" | "typesafe" | "openrouter";
export const DEFAULT_JEV_TRANSPORT: JevTransport = "auto";
export const JEV_TRANSPORTS: JevTransport[] = [
  "auto",
  "typesafe",
  "openrouter",
];

export type AdvisorToolPolicy = "full" | "summary" | "exclude";
export type AdvisorToolPolicies = Record<string, AdvisorToolPolicy>;
export const ADVISOR_TOOL_POLICIES: AdvisorToolPolicy[] = [
  "full",
  "summary",
  "exclude",
];

export type GateFailureMode =
  | "block-session"
  | "block-tool"
  | "warn-and-continue";
export const GATE_FAILURE_MODES: GateFailureMode[] = [
  "block-session",
  "block-tool",
  "warn-and-continue",
];

export interface AdvisorConfig {
  advisor?: string;
  advisorAutoLoopGate?: boolean;
  advisorBlockOnBlocked?: boolean;
  advisorCollapseResponses?: boolean;
  advisorCompletionGate?: boolean;
  advisorCustomInvocation?: string;
  advisorEffort?: string;
  advisorFailureGate?: boolean;
  advisorGitContext?: GitContextLevel;
  advisorGitContextMaxChars?: number;
  advisorHerdrIntegration?: boolean;
  advisorJevDigestMaxChars?: number;
  advisorJevFilterEnabled?: boolean;
  advisorJevFilterNoulMargin?: number;
  advisorJevFilterOverrideWindow?: number;
  advisorJevFilterSkipConfidence?: number;
  advisorJevModel?: string;
  advisorJevPricePerMtok?: number;
  advisorJevTimeoutMs?: number;
  advisorJevTransport?: JevTransport;
  advisorJevTurnGateEveryTurns?: number;
  advisorJevTurnGateNoulThreshold?: number;
  advisorLoopThreshold?: number;
  advisorMaxCallsPerSession?: number;
  advisorModelWhitelist?: string[];
  advisorOutcomeLogging?: boolean;
  advisorPlanGate?: boolean;
  advisorRedactSecrets?: boolean;
  advisorScoutEnabled?: boolean;
  advisorSessionSummary?: boolean;
  advisorToolPolicies?: AdvisorToolPolicies;
  advisorToolResultMaxBytes?: number;
  advisorToolResultMaxLines?: number;
  advisorTrackedFileContent?: boolean;
  advisorUntrackedContent?: boolean;
  alwaysOn?: boolean;
  contextMaxChars?: number;
  executor?: string;
  executorEffort?: string;
  gateFailureMode?: GateFailureMode;
  showUsageDetails?: boolean;
  showUsageFooter?: boolean;
  simpleMode?: boolean;
}
