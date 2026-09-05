import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import type { GitContextLevel } from "../git.js";

export const DEFAULT_CONTEXT_MAX_CHARS = 15_000;
export const MAX_CONTEXT_MAX_CHARS = Number.MAX_SAFE_INTEGER;
export const DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES = DEFAULT_MAX_LINES;
export const DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES = DEFAULT_MAX_BYTES;
export const DEFAULT_ADVISOR_GIT_CONTEXT_MAX_CHARS = 20_000;

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
  advisorLoopThreshold?: number;
  advisorMaxCallsPerSession?: number;
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
