import type {
  BenchmarkMode,
  RoleUsage,
  RuntimeConfigurationSnapshot,
  TrajectoryEvent,
} from "../src/types.js";

export const SWEBENCH_SCHEMA_VERSION = 1 as const;
export const SWEBENCH_FAILURES = [
  "success",
  "model-validation-failure",
  "model-timeout",
  "provider-failure",
  "benchmark-setup-failure",
  "benchmark-runtime-configuration-failure",
] as const;
export type SwebenchFailure = (typeof SWEBENCH_FAILURES)[number];

export interface SwebenchTask {
  baseCommit: string;
  failToPass: string[];
  id: string;
  instanceId: string;
  passToPass: string[];
  problemStatement: string;
  repo: string;
  solutionPatch: string;
  solutionPatchSha256: string;
  testFiles: string[];
  testPatch: string;
  testPatchSha256: string;
  validation: { program: string; args: string[] };
  version: string;
}

export interface SwebenchManifest {
  dataset: string;
  datasetSnapshot: string;
  experimentId: string;
  repositorySource: string;
  schemaVersion: 1;
  selectionProtocol: string;
  tasks: SwebenchTask[];
}

export interface WorkspaceState {
  commit: string;
  treeHash: string;
}

export type SwebenchRepository =
  | "django"
  | "matplotlib"
  | "scikit-learn"
  | "sphinx"
  | "sympy"
  | "local";

export interface RepositoryEnvironment {
  adapter: SwebenchRepository;
  adapterVersion: string;
  build?: { program: string; args: string[] };
  buildSource?: string;
  environmentFingerprint: string;
  installedPackages: string[];
  python: string;
  setupCommand: string;
  setupOutput: { stderrSummary: string; stdoutSummary: string };
  variables: Record<string, string>;
}

export interface PreparedWorkspace {
  base: WorkspaceState;
  cleanup: () => void;
  environment: RepositoryEnvironment;
  prepared: WorkspaceState;
  root: string;
  testFiles: string[];
  testPatchHash: string;
  workspace: string;
}

export interface EnvironmentFingerprint {
  adapter: SwebenchRepository;
  adapterVersion: string;
  apiType: string;
  architecture: string;
  baseCommit: string;
  effectiveProviderSettings: Record<string, unknown>;
  environmentFingerprint: string;
  os: string;
  piModel: string;
  preparedWorkspaceHash: string;
  pristineWorkspaceHash: string;
  provider: string;
  reasoningConfiguration: string;
  repository: string;
  resolvedModel: string;
  runtime: Record<string, string>;
  systemPromptHash: string;
  testPatchHash: string;
  timeoutSeconds: number;
  toolDefinitionsHash: string;
}

export interface ModelPatchTelemetry {
  artifactPath: string;
  diffBytes: number;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  patchSha256: string;
  productionFilesChanged: string[];
  protectedTestMutation: boolean;
  testFilesChanged: string[];
}

export interface SwebenchValidation {
  command: string;
  durationMs: number;
  exitCode: number | null;
  failureReason?: string;
  passed: boolean;
  signal?: string;
  stderrSummary: string;
  stdoutSummary: string;
  timedOut: boolean;
}

export interface SwebenchRunRecord {
  base: WorkspaceState;
  createdAt: string;
  durationMs: number;
  environmentFingerprint: EnvironmentFingerprint;
  error?: string;
  executionId: string;
  experimentId: string;
  instanceId: string;
  metrics: {
    cost: number | null;
    durationMs: number;
    modelCalls: number;
    agentTurns: number;
    toolCalls: number;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    providerCost: number | null;
  };
  mode: Extract<BenchmarkMode, "sol" | "luna" | "luna-advisor-optional">;
  model: string;
  modelPatch: ModelPatchTelemetry;
  piModel: string;
  planSha256?: string;
  prepared: WorkspaceState;
  primaryCategory: SwebenchFailure;
  provider: string;
  providerConfiguration: {
    declared: {
      temperature: number | null;
      samplingParams: Record<string, unknown>;
    };
    effective: Record<string, unknown>[];
    sampling: "provider-controlled" | "transmitted" | "unsupported";
  };
  repetition: number;
  resolvedModel: string;
  runtime?: RuntimeConfigurationSnapshot;
  scheduleIndex?: number;
  scheduleSha256?: string;
  schemaVersion: 1;
  scorable: boolean;
  success: boolean;
  taskId: string;
  termination: { state: string; error?: string };
  testFiles: string[];
  testPatchHash: string;
  trajectoryEvents?: TrajectoryEvent[];
  usage?: {
    executor: RoleUsage;
    advisor: RoleUsage;
    scout: RoleUsage;
  };
  validation: SwebenchValidation;
}

export interface PreflightPhase {
  command: string;
  durationMs: number;
  exception?: string;
  exitCode: number | null;
  failureClass?: string;
  passed: boolean;
  stderrSummary: string;
  stdoutSummary: string;
  timedOut: boolean;
}

export interface PreflightRow {
  adapter?: string;
  adapterVersion?: string;
  base: "PASS" | "FAIL";
  environment?: string;
  environmentFingerprint: "COMPLETE" | "INCOMPLETE";
  error?: string;
  gold: "PASS" | "FAIL";
  initial: "PASS" | "FAIL";
  phases?: {
    checkout: PreflightPhase;
    testPatch: PreflightPhase;
    environment: PreflightPhase;
    initial: PreflightPhase;
    goldPatch: PreflightPhase;
    goldValidation: PreflightPhase;
    reverted: PreflightPhase;
  };
  ready?: boolean;
  repo?: string;
  repositoryPath?: string;
  reverted: "PASS" | "FAIL";
  taskId: string;
  testPatch: "PASS" | "FAIL";
}
