export const BENCHMARK_SCHEMA_VERSION = 1 as const;
export const BENCHMARK_HARNESS_VERSION = "failsafe-bench-1" as const;
export const UNAVAILABLE = "unavailable" as const;

export type Unavailable = typeof UNAVAILABLE;
export type CostValue = number | Unavailable;
export type GateDecision = "proceed" | "revise" | "blocked";
export type GateFailureMode =
  | "block-session"
  | "block-tool"
  | "warn-and-continue";
export type ReplayCase =
  | "proceed"
  | "revise"
  | "blocked"
  | "malformed"
  | "duplicated"
  | "contradictory";
export type DecisionPolarity = "positive" | "negative";
export type CandidateBand = "trivial" | "candidate-uplift" | "out-of-reach";
export type BenchmarkTier = "replay" | "decisions" | "screen" | "evaluate";
export type ArmName =
  | "null"
  | "cheap"
  | "frontier"
  | "oracle"
  | "E"
  | "E+A"
  | "F"
  | "F′";
export type ModelRole = "executor" | "advisor" | "judge";

export interface ModelPin {
  effort: string;
  model: string;
  role: ModelRole;
}

export interface UsageSnapshot {
  cacheRead: number | null;
  cacheWrite: number | null;
  input: number | null;
  output: number | null;
  totalTokens: number | null;
  usageAvailable: boolean;
}

export interface PricingRates {
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface RoleCost {
  calls: number;
  configuredCost: CostValue;
  model: string;
  providerCost: CostValue;
  role: ModelRole;
  usage: UsageSnapshot;
}

export interface BenchmarkPins {
  advisorVersion: string;
  fixtureHashes: Record<string, string>;
  gateSettings: Record<string, unknown>;
  modelPins: Record<string, ModelPin>;
  piVersion: string;
  reactBenchCommit: string;
  reactDoctorVersion: string;
}

export interface BudgetEstimate {
  capUsd: number;
  estimatedUsd: number;
  expectedCalls: number;
  maxCalls: number;
  tokenAssumption: {
    input: number;
    output: number;
  };
}

export interface GateFixture {
  case: ReplayCase;
  expected: GateDecision | "failure";
  failureMode: GateFailureMode;
  response: string;
}

export interface ReplayFixture {
  gate?: GateFixture;
  id: string;
  payload: Record<string, unknown>;
  volatileFields: string[];
}

export interface ReplayCapture {
  fixtureId: string;
  leakCount: number;
  leaks: string[];
  normalizedPayloadHash: string;
  payload: Record<string, unknown>;
  payloadBytes: number;
  response: string;
}

export interface DecisionKey {
  defectClass: string;
  findingId?: string;
  reasonTokens: string[];
  targetFile: string;
  targetSymbol: string;
}

export interface DecisionTrap {
  choice: string;
  tokens: string[];
}

export interface DecisionItem {
  band?: CandidateBand;
  conversation: string;
  draft: string;
  id: string;
  key: DecisionKey;
  polarity: DecisionPolarity;
  provenance: {
    origin: string;
    reactBenchCommit?: string;
  };
  repoPath: string;
  traps: DecisionTrap[];
}

export interface DecisionScore {
  arm: ArmName;
  caught: boolean;
  falseAlarm: boolean;
  itemId: string;
  judge?: boolean | null;
  judgeAvailable?: boolean;
  justification?: string;
  latencyMs?: number;
  mechanical: boolean | null;
  usage?: unknown;
}

export interface BandScreenResult {
  candidateBand: CandidateBand;
  executorPasses: boolean[];
  frontierPasses: boolean[];
  taskId: string;
}

export interface DiscordantPairs {
  exactMcNemarPValue: number | null;
  executorFailAdvisorPass: number;
  executorPassAdvisorFail: number;
  taskCount: number;
}

export interface BenchmarkReport {
  budget?: BudgetEstimate;
  controls?: {
    invalid: boolean;
    oracleCatchRate: number;
    oracleFalseAlarmRate: number;
    nullCatchRate: number;
  };
  generatedAt: string;
  metrics: Record<string, unknown>;
  pins: BenchmarkPins;
  schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
  status: "PASS" | "INVALID" | "UNAVAILABLE";
  tier: BenchmarkTier;
  warnings: string[];
}

export interface BenchmarkConfig {
  budgetUsd: number;
  fixtureRoot: string;
  gateFailureModes: GateFailureMode[];
  modelPins: Record<string, ModelPin>;
  pricing: Record<string, PricingRates>;
  reactBenchCommit: string;
  reactDoctorVersion: string;
  reportRoot: string;
  seed: number;
}

export interface RecordedProviderRequest {
  arm?: string;
  effort?: string;
  model?: string;
  provider?: string;
  reasoning?: string;
  role?: string;
  [key: string]: unknown;
}
