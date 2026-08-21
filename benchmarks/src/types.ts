/* biome-ignore-all assist/source/useSortedInterfaceMembers: result contracts are grouped by lifecycle and role for readability. */
import type { Usage } from "@earendil-works/pi-ai/compat";

export const BENCHMARK_SCHEMA_VERSION = 1 as const;
export const BENCHMARK_HARNESS_VERSION = "trajectory-pilot-3-audit" as const;
/** The four historical modes. They remain the default so old runs are not silently replaced. */
export const MODES = [
  "baseline",
  "small-baseline",
  "advisor",
  "advisor-scout",
] as const;
export const EXPERIMENTAL_MODES = [
  "sol",
  "luna",
  "luna-advisor-optional",
  "luna-advisor-mandatory",
  "luna-advisor-scout",
  "advisor-guidance",
] as const;
export const ALL_MODES = [...MODES, ...EXPERIMENTAL_MODES] as const;
export type BenchmarkMode = (typeof ALL_MODES)[number];
export type AdvisorCallPolicy = "none" | "optional" | "mandatory";
export type AdvisorTrustPolicy = "current" | "guidance";
export interface BenchmarkModePolicy {
  advisorCallPolicy: AdvisorCallPolicy;
  advisorTrustPolicy: AdvisorTrustPolicy;
  advisorToolAvailable: boolean;
  scoutAvailable: boolean;
}
export const CATEGORIES = [
  "implementation",
  "debugging",
  "reasoning",
  "recovery",
] as const;
export type BenchmarkCategory = (typeof CATEGORIES)[number];
export type RoleName = "executor" | "advisor" | "scout";

export interface PricingRates {
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface ModelAliasConfig {
  ref: string;
}

export interface BenchmarkExecutionConfig {
  agentRetries: number;
  compactionEnabled: boolean;
  runs: number;
  samplingParams?: Record<string, unknown>;
  seed: number;
  temperature?: number;
  timeoutSeconds: number;
  tools: string[];
  validatorTimeoutSeconds?: number;
}

export interface BenchmarkOutputConfig {
  reportJsonPath: string;
  reportMarkdownPath: string;
  resultsPath: string;
}

export interface BenchmarkConfig {
  execution: BenchmarkExecutionConfig;
  models: { frontier: ModelAliasConfig; small: ModelAliasConfig };
  output: BenchmarkOutputConfig;
  pricing: Record<string, PricingRates>;
  provenance?: { name?: string; version?: string };
}

export interface ValidationSpec {
  args: string[];
  program: string;
  timeoutSeconds?: number;
}

export interface BenchmarkTaskManifest {
  category: BenchmarkCategory;
  fixture: string;
  id: string;
  metadata?: Record<string, unknown>;
  prompt: string;
  timeoutSeconds?: number;
  validation: ValidationSpec;
}

export interface ResolvedTask
  extends Omit<BenchmarkTaskManifest, "fixture" | "validation"> {
  fixtureHash: string;
  fixturePath: string;
  taskHash: string;
  validation: ValidationSpec & { program: string };
  validatorHash: string;
  validatorPath: string;
}

export interface RunSpec {
  agentDir: string;
  authPath?: string;
  benchmarkConfigHash: string;
  config: BenchmarkConfig;
  configPath: string;
  expectedModels: { executor: string; advisor?: string; scout?: string };
  benchmarkConfigFileHash?: string;
  mode: BenchmarkMode;
  modelsPath?: string;
  repetition: number;
  runId: string;
  runKey: string;
  seed: number;
  task: ResolvedTask;
  telemetryToken: string;
  workspacePath: string;
}

export interface UsageSnapshot {
  cacheRead: number | null;
  cacheWrite: number | null;
  input: number | null;
  output: number | null;
  totalTokens: number | null;
  usageAvailable: boolean;
}

export interface RoleUsage extends UsageSnapshot {
  calls: number;
  configuredCost: number | null;
  diagnostics?: RoleDiagnostic[];
  invocationStatus: "inactive" | "observed" | "unknown";
  model: string;
  providerCost: number | null;
  requestedRef?: string;
  role: RoleName;
}

export interface AdvisorDiagnostic {
  iteration?: number;
  outcome?: string;
  question?: string;
  response?: string;
  timestamp: string;
  trigger?: string;
}

export interface ScoutDiagnostic {
  availableCount?: number;
  fallback?: string;
  latencyMs?: number;
  selectedCount?: number;
  synthesis?: string;
  timestamp: string;
}

export type RoleDiagnostic = AdvisorDiagnostic | ScoutDiagnostic;

export type FailureClass =
  | "success"
  | "validation-failure"
  | "validator-timeout"
  | "agent-timeout"
  | "agent-failure"
  | "provider-failure"
  | "infrastructure-failure";

export interface ValidationResult {
  durationMs: number;
  exitCode: number | null;
  failureClass?: "success" | "validation-failure" | "validator-timeout";
  /** Structured validator output, retained after the run and never sent to the agent. */
  invariant?: string;
  failureReason?: string;
  passed: boolean;
  signal?: string;
  stderrSummary: string;
  stdoutSummary: string;
  timedOut: boolean;
}

export interface Termination {
  error?: string;
  sessionSettled: boolean;
  state:
    | "settled"
    | "agent-error"
    | "provider-error"
    | "timeout"
    | "aborted"
    | "worker-error"
    | "unknown";
  stopReason?: string;
}

export interface TrajectoryMetrics {
  agentTurns?: number;
  changedFiles: number;
  edits: number;
  failedValidationCycles: number;
  fileReads: number;
  modelCalls: number;
  testExecutions: number;
  toolCalls: number;
}

export interface TrajectoryEvent {
  command?: string;
  path?: string;
  timeoutSeconds?: number;
  sequence: number;
  timestamp: string;
  tool?: string;
  question?: string;
  trigger?: string;
  type: "advisor" | "bash" | "edit" | "read" | "tool" | "write";
}

export interface RuntimeConfigurationSnapshot {
  advisorAssigned: boolean;
  advisorCallPolicy: AdvisorCallPolicy;
  advisorTrustPolicy: AdvisorTrustPolicy;
  advisorOrchestration: {
    alwaysOn: boolean;
    autoLoopGate: boolean;
    completionGate: boolean;
    failureGate: boolean;
    gitContext: string;
    maxCallsPerSession: number;
    planGate: boolean;
    scoutEnabled: boolean;
  } | null;
  advisorCallsObserved: number;
  agentMaxTurns: number | null;
  agentRetryPolicy: { enabled: boolean; maxRetries: number };
  benchmarkConfigHash: string;
  benchmarkConfigFileHash?: string;
  compactionEnabled: boolean;
  contextLimits: {
    modelContextWindow: number;
    modelMaxOutputTokens: number;
    configuredAgentTimeoutMs: number;
    configuredValidatorTimeoutMs?: number;
  };
  effectiveSystemPrompt: string;
  effectiveSystemPromptHash: string;
  effectiveUserPrompt: string;
  effectiveUserPromptHash: string;
  environmentVariables: Record<string, string | null>;
  executionTimeoutMs: number;
  fixtureHash: string;
  initialWorkspaceHash: string;
  maxOutputTokens: number;
  mode: BenchmarkMode;
  /** Sanitized provider-level request options, one entry per executor call. */
  providerRequestFields: Record<string, unknown>[];
  modelCapabilities: {
    api: string;
    contextWindow: number;
    id: string;
    input: string[];
    maxTokens: number;
    provider: string;
    reasoning: boolean;
    samplingParams?: Record<string, unknown>;
    thinkingLevel: string;
    thinkingLevelMap?: Record<string, string | null>;
  };
  profileHash: string;
  reasoningEffort: string | null;
  requestedModel: string;
  resolvedModel: string;
  taskHash: string;
  temperature: number | null;
  toolAvailability: string[];
  toolDefinitions: Array<{
    description: string;
    name: string;
    parameters: unknown;
    promptGuidelines?: string[];
    sourceInfo: unknown;
  }>;
  toolTimeouts: Record<string, number | null>;
  topP: number | null;
}

export interface WorkspaceDiffSummary {
  added: number;
  changedPaths: string[];
  deleted: number;
  diffBytes: number;
  modified: number;
}

export interface Provenance {
  benchmarkConfigHash: string;
  harnessVersion?: typeof BENCHMARK_HARNESS_VERSION;
  fixtureHash: string;
  gitCommit?: string;
  packageVersion?: string;
  profileHash: string;
  schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
  systemPromptHash: string;
  taskHash: string;
  validatorHash?: string;
}

export interface RawBenchmarkResult {
  advisor: RoleUsage;
  agentDurationMs: number;
  category: BenchmarkCategory;
  correct: boolean;
  createdAt: string;
  durationMs: number;
  executor: RoleUsage;
  failureClass?: FailureClass;
  infrastructureFailure?: string;
  mode: BenchmarkMode;
  /** Stable identity shared by modes in one experimental configuration. */
  experimentHash?: string;
  modelIds: {
    requested: Record<RoleName, string | null>;
    resolved: Record<RoleName, string | null>;
  };
  profile: {
    tools: string[];
    compactionEnabled: boolean;
    agentRetries: number;
    temperature?: number;
    samplingParams?: Record<string, unknown>;
  };
  provenance: Provenance;
  repetition: number;
  runId: string;
  runKey?: string;
  schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
  scout: RoleUsage;
  seed: number;
  setupDurationMs: number;
  taskId: string;
  trajectory?: TrajectoryMetrics;
  trajectoryEvents?: TrajectoryEvent[];
  runtime?: RuntimeConfigurationSnapshot;
  termination: Termination;
  totalCost: number | null;
  validation: ValidationResult;
  validationDurationMs: number;
  workspace: WorkspaceDiffSummary;
}

export interface BootstrapInterval {
  estimate: number;
  high: number | null;
  insufficient: boolean;
  low: number | null;
}
export interface FailureCounts {
  agentFailure: number;
  agentTimeout: number;
  infrastructureFailure: number;
  providerFailure: number;
  success: number;
  validationFailure: number;
  validatorTimeout: number;
}

export interface Distribution {
  max: number | null;
  median: number | null;
  p90: number | null;
}

export interface AggregateMetrics {
  attempts: number;
  completedRuns: number;
  completedValidationRate: number | null;
  correctness: number;
  correctnessCI?: BootstrapInterval;
  costCI?: BootstrapInterval;
  costCoverage: number;
  costCoveragePercent: number;
  costPerAttempt: number | null;
  costPerSuccess: number | null;
  costPerSuccessCoverage: number;
  failures: FailureCounts;
  failureInvariants: Record<string, number>;
  observed: {
    agentTurns: Distribution;
    cachedTokens: Distribution;
    inputTokens: Distribution;
    modelCalls: Distribution;
    outputTokens: Distribution;
    toolCalls: Distribution;
  };
  meanCost: number | null;
  medianDurationMs: number | null;
  speedIndex: number | null;
  successes: number;
  timeoutRate: number;
  usageComplete: number;
}

export interface BenchmarkReport {
  byCategory: Partial<
    Record<BenchmarkCategory, Record<BenchmarkMode, AggregateMetrics>>
  >;
  comparisons: {
    correctnessDelta: number | null;
    costReduction: number | null;
    speedDelta: number | null;
    frontierQualityRetained: number | null;
    advisorCallsPerAttempt: number | null;
    advisorTaskUsePercent: number | null;
    scoutOverhead: {
      calls: number;
      costDelta: number | null;
      tokenDelta: number | null;
      advisorInputTokenDelta: number | null;
      correctnessDelta: number | null;
    };
    rescue: {
      threshold: number;
      failedSmallBaseline: number;
      rescued: number;
      regressions: number;
      regressionRate: number | null;
      rate: number | null;
      insufficient: boolean;
    };
    outcomeIntersection: {
      allModesPass: number;
      solOnly: number;
      lunaOnly: number;
      advisorRescue: number;
      advisorRegression: number;
      comparablePairs: number;
      missingPairs: number;
    };
    scoutTransitions: {
      advisorFailScoutPass: number;
      advisorPassScoutFail: number;
      unchangedPass: number;
      unchangedFail: number;
      comparablePairs: number;
      missingPairs: number;
    };
  };
  generatedAt: string;
  inputPath: string;
  modes: Record<BenchmarkMode, AggregateMetrics>;
  pairedDiagnostics: Array<{
    taskId: string;
    smallBaseline: boolean;
    advisor: boolean;
    repetitions: number;
  }>;
  runs: number;
  schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
  seed: number;
  warnings: string[];
}

export type UsageLike = Partial<Usage> & { cost?: Partial<Usage["cost"]> };
