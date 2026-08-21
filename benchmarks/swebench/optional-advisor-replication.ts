/* Randomized paired replication of the frozen optional-Advisor treatment. */
/* biome-ignore-all assist/source/useSortedKeys: persisted artifacts follow the experiment protocol order. */
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: fail-closed experiment lifecycle gates remain explicit. */
/* biome-ignore-all lint/performance/noAwaitInLoops: each pair is intentionally sequential to preserve locality. */
/* biome-ignore-all lint/suspicious/noBitwiseOperators: the reproducible PRNG uses uint32 arithmetic. */
/* biome-ignore-all lint/style/noIncrementDecrement: scheduler counters are local and bounded. */
import { execFile } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { loadBenchmarkConfig, modePolicy } from "../src/config.js";
import { hashText } from "../src/isolation.js";
import { activeToolsForMode } from "../src/profile.js";
import { loadManifest } from "./adapter.js";
import {
  canonicalJsonHash,
  semanticManifestIdentity,
} from "./manifest-identity.js";
import { assertPreflight, runOne } from "./runner.js";
import type {
  PreflightRow,
  SwebenchManifest,
  SwebenchRunRecord,
} from "./types.js";

const execFileAsync = promisify(execFile);
const SOL = "openai-codex/gpt-5.6-sol";
const LUNA = "openai-codex/gpt-5.6-luna";
const OPTIONAL = "luna-advisor-optional" as const;
const DEFAULT_EXPERIMENT =
  "exp-20260822-swebench-hard-optional-advisor-v1-replication-v3";
const MANIFEST = "benchmarks/swebench/hard-baseline-v2-manifest.json";
const POOL =
  "benchmarks/swebench/artifacts/hard-baseline-v1/candidate-pool.json";
const PROVENANCE =
  "benchmarks/swebench/artifacts/hard-baseline-v2/selection-provenance.json";
const CACHE = "benchmarks/swebench/cache";
const CONFIG = "benchmarks/config/benchmark.local.json";
const ARTIFACTS = "benchmarks/swebench/artifacts";
const RESULTS = "benchmarks/swebench/results";
const REPORT = "benchmarks/SWEBENCH-HARD-OPTIONAL-ADVISOR-V1-REPLICATION.md";
const PREFLIGHT_ARTIFACT =
  "benchmarks/swebench/artifacts/hard-baseline-v2/preflight-baseline-gate-current.json";
const V1_RESULTS =
  "benchmarks/swebench/results/exp-20260820-swebench-hard-optional-advisor-v1.jsonl";
const CANONICAL =
  "44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193";
const SEMANTIC =
  "f47a191590b8a39880a6770023035e812e8cae886b94a0f16e34e7c59dcbd588";
const CANDIDATE_POOL =
  "6282101e12dd1d79667de8f04e45554971d329c9be058b864186fb7394eb9dbb";
const ADAPTER_VERSION = "2026-08-19.3";
const EXPERIMENT_ID_PATTERN = /^exp-[a-z0-9-]+$/;
const SEED = 20_260_822;
const REPETITIONS = 3;

export interface ReplicationEntry {
  index: number;
  instanceId: string;
  mode: "luna" | typeof OPTIONAL;
  model: string;
  pairId: string;
  pairIndex: number;
  repetition: number;
  repo: string;
  taskId: string;
  withinPairOrder: 0 | 1;
}

export interface ReplicationPair {
  entries: [ReplicationEntry, ReplicationEntry];
  pairId: string;
  pairIndex: number;
  repetition: number;
  taskId: string;
}

const json = <T>(path: string) =>
  JSON.parse(readFileSync(resolve(path), "utf8")) as T;
const hashFile = (path: string) =>
  hashText(readFileSync(resolve(path), "utf8"));
const writeAtomic = (path: string, value: unknown) => {
  const target = resolve(path);
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, target);
};
const writeFileFile = (path: string, value: string) =>
  writeFileSync(path, value, { flag: "wx" });
const rng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_00_00_00_00;
  };
};
const shuffle = <T>(items: T[], next: () => number) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};
const modelFor = (mode: ReplicationEntry["mode"]) =>
  mode === "luna" ? LUNA : LUNA;
const sourceSlice = (path: string, start: string, end: string) => {
  const source = readFileSync(resolve(path), "utf8");
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) {
    throw new Error(`Treatment identity source boundary missing: ${path}`);
  }
  return source.slice(from, to + end.length);
};
const treatmentConfigurations = (tools: string[]) => ({
  lunaExecutor: {
    advisorMaxCallsPerSession: 0,
    advisorOrchestration: {
      autoLoopGate: false,
      completionGate: false,
      failureGate: false,
      planGate: false,
      scoutEnabled: false,
    },
    advisorPolicy: modePolicy("luna"),
    executor: LUNA,
    generatedConfig: {
      advisorAutoLoopGate: false,
      advisorCompletionGate: false,
      advisorFailureGate: false,
      advisorGitContext: "off",
      advisorMaxCallsPerSession: 0,
      advisorPlanGate: false,
      advisorRedactSecrets: true,
      advisorScoutEnabled: false,
      advisorSessionSummary: false,
      alwaysOn: false,
      executor: LUNA,
    },
    tools: activeToolsForMode("luna", tools),
  },
  optionalAdvisor: {
    advisor: SOL,
    advisorMaxCallsPerSession: 4,
    advisorOrchestration: {
      autoLoopGate: false,
      completionGate: false,
      failureGate: false,
      planGate: false,
      scoutEnabled: false,
    },
    advisorPolicy: modePolicy(OPTIONAL),
    executor: LUNA,
    generatedConfig: {
      advisor: SOL,
      advisorAutoLoopGate: false,
      advisorCompletionGate: false,
      advisorFailureGate: false,
      advisorGitContext: "off",
      advisorMaxCallsPerSession: 4,
      advisorPlanGate: false,
      advisorRedactSecrets: true,
      advisorScoutEnabled: false,
      advisorSessionSummary: false,
      alwaysOn: false,
      executor: LUNA,
    },
    tools: activeToolsForMode(OPTIONAL, tools),
  },
});

export const buildTreatmentIdentity = (
  manifest: SwebenchManifest,
  config: ReturnType<typeof loadBenchmarkConfig>
) => {
  const toolsSource = readFileSync(resolve("src/tools.ts"), "utf8");
  const askStart = toolsSource.lastIndexOf(
    "  pi.registerTool({",
    toolsSource.indexOf('    name: "ask_advisor"')
  );
  const askEnd = toolsSource.indexOf(
    "\n  pi.registerTool({",
    toolsSource.indexOf('    name: "ask_advisor"')
  );
  if (askStart < 0 || askEnd < 0) {
    throw new Error(
      "Treatment identity ask_advisor definition boundary missing"
    );
  }
  const taskPromptSource = sourceSlice(
    "benchmarks/swebench/adapter.ts",
    "export const toWorkerTask =",
    "export const workerSpec ="
  );
  const validationSource = sourceSlice(
    "benchmarks/swebench/adapter.ts",
    "export const validateTaskState =",
    "export const validateModelState ="
  );
  const advisorSystemSource = sourceSlice(
    "src/tools.ts",
    "export const ADVISOR_SYSTEM =",
    "export const ADVISOR_DECISION_SYSTEM ="
  );
  const policySource = sourceSlice(
    "benchmarks/src/config.ts",
    "export const modePolicy =",
    "export const defaultModes ="
  );
  const provenance = json<Record<string, unknown>>(PROVENANCE);
  const canonical = canonicalJsonHash(manifest);
  const semantic = semanticManifestIdentity(manifest, provenance);
  const pool = canonicalJsonHash(json(POOL));
  const configurations = treatmentConfigurations(config.config.execution.tools);
  const v1Records = existsSync(resolve(V1_RESULTS))
    ? readFileSync(resolve(V1_RESULTS), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as SwebenchRunRecord)
    : [];
  const v1Runtime = v1Records.map((record) => ({
    advisorAssigned: record.runtime?.advisorAssigned,
    advisorCallPolicy: record.runtime?.advisorCallPolicy,
    advisorOrchestration: record.runtime?.advisorOrchestration,
    advisorTrustPolicy: record.runtime?.advisorTrustPolicy,
    mode: record.mode,
    taskId: record.taskId,
  }));
  const reference = {
    adapterHash:
      "sha256:a7ad9c6803c56e9d7a01db5479e1b0bd91e1064c3ae2659ab6f402a17a428c77",
    adapterVersion: ADAPTER_VERSION,
    candidatePoolSha256: CANDIDATE_POOL,
    configHash:
      "sha256:129aefdfb2160539ff2385416114689a5939a8bbfc3ca3e693d00b6123bacde4",
    executorConfigurationHash:
      "427b45970f59e67b8f56fcc16eef8fc79c3b1467697ee05c19e6711a9655da56",
    advisorConfigurationHash:
      "f911bfe6b4a074e9a27028b9a1effd3beccaea46c78ab9336a5ceeec72e42143",
    manifestCanonicalSha256: CANONICAL,
    manifestSemanticSha256: SEMANTIC,
    maxAdvisorCalls: 4,
    models: { advisor: SOL, executor: LUNA },
    policy: modePolicy(OPTIONAL),
    promptTreatment: "exact frozen task prompt; no benchmark treatment suffix",
    scout: false,
    v1Experiment: "exp-20260820-swebench-hard-optional-advisor-v1",
  };
  const current = {
    adapterHash: hashFile("benchmarks/swebench/adapter.ts"),
    adapterVersion: ADAPTER_VERSION,
    askAdvisorToolDefinitionHash: hashText(toolsSource.slice(askStart, askEnd)),
    advisorSystemPromptHash: hashText(advisorSystemSource),
    candidatePoolSha256: pool,
    configHash: config.hash,
    executorConfiguration: configurations.lunaExecutor.generatedConfig,
    executorConfigurationHash: canonicalJsonHash(
      configurations.lunaExecutor.generatedConfig
    ),
    executorTaskPromptSourceHash: hashText(taskPromptSource),
    frozenManifestCanonicalSha256: canonical,
    frozenManifestSemanticSha256: semantic,
    advisorConfiguration: configurations.optionalAdvisor.generatedConfig,
    advisorConfigurationHash: canonicalJsonHash(
      configurations.optionalAdvisor.generatedConfig
    ),
    maxAdvisorCalls: configurations.optionalAdvisor.advisorMaxCallsPerSession,
    models: {
      advisor: configurations.optionalAdvisor.advisor,
      executor: configurations.optionalAdvisor.executor,
    },
    policy: configurations.optionalAdvisor.advisorPolicy,
    promptTreatment: "exact frozen task prompt; no benchmark treatment suffix",
    policySourceHash: hashText(policySource),
    scout: configurations.optionalAdvisor.advisorPolicy.scoutAvailable,
    validationLifecycleHash: hashText(validationSource),
  };
  const referenceChecks = {
    adapter:
      current.adapterHash === reference.adapterHash &&
      current.adapterVersion === reference.adapterVersion,
    candidatePool:
      current.candidatePoolSha256 === reference.candidatePoolSha256,
    config: current.configHash === reference.configHash,
    executorConfiguration:
      current.executorConfigurationHash === reference.executorConfigurationHash,
    advisorConfiguration:
      current.advisorConfigurationHash === reference.advisorConfigurationHash,
    manifest:
      current.frozenManifestCanonicalSha256 ===
        reference.manifestCanonicalSha256 &&
      current.frozenManifestSemanticSha256 === reference.manifestSemanticSha256,
    maxAdvisorCalls: current.maxAdvisorCalls === reference.maxAdvisorCalls,
    models: JSON.stringify(current.models) === JSON.stringify(reference.models),
    policy: JSON.stringify(current.policy) === JSON.stringify(reference.policy),
    promptTreatment: current.promptTreatment === reference.promptTreatment,
    scout: current.scout === reference.scout,
    v1RuntimeEvidence:
      v1Runtime.length === 40 &&
      v1Runtime.every((row) =>
        row.mode === "luna"
          ? row.advisorAssigned === false && row.advisorCallPolicy === "none"
          : row.advisorAssigned === true && row.advisorCallPolicy === "optional"
      ),
  };
  const matches = Object.values(referenceChecks).every(Boolean);
  return {
    current,
    identityHash: canonicalJsonHash(current),
    matches,
    reference,
    referenceChecks,
    v1RuntimeEvidence: v1Runtime,
  };
};

export const createReplicationSchedule = (
  manifest: SwebenchManifest,
  seed = SEED
): ReplicationPair[] => {
  const next = rng(seed);
  const pairSeeds = shuffle(
    manifest.tasks.flatMap((task) =>
      Array.from({ length: REPETITIONS }, (_, repetition) => ({
        repetition,
        task,
      }))
    ),
    next
  );
  return pairSeeds.map(({ repetition, task }, pairIndex) => {
    const firstMode: ReplicationEntry["mode"] =
      next() < 0.5 ? "luna" : OPTIONAL;
    const secondMode = firstMode === "luna" ? OPTIONAL : "luna";
    const pairId = `pair-${String(pairIndex + 1).padStart(2, "0")}-${task.id}-r${repetition + 1}`;
    const makeEntry = (
      mode: ReplicationEntry["mode"],
      withinPairOrder: 0 | 1
    ): ReplicationEntry => ({
      index: pairIndex * 2 + withinPairOrder,
      instanceId: task.instanceId,
      mode,
      model: modelFor(mode),
      pairId,
      pairIndex,
      repetition,
      repo: task.repo,
      taskId: task.id,
      withinPairOrder,
    });
    return {
      pairId,
      pairIndex,
      repetition,
      taskId: task.id,
      entries: [makeEntry(firstMode, 0), makeEntry(secondMode, 1)],
    };
  });
};

const append = (fd: number, record: SwebenchRunRecord) => {
  writeFileSync(fd, `${JSON.stringify(record)}\n`);
  fsyncSync(fd);
};
const git = async (args: string[]) =>
  (
    await execFileAsync("git", args, { maxBuffer: 20 * 1024 * 1024 })
  ).stdout.trim();
const fatalCategory = (record: SwebenchRunRecord) =>
  [
    "provider-failure",
    "benchmark-setup-failure",
    "benchmark-runtime-configuration-failure",
  ].includes(record.primaryCategory);

export const executeOptionalAdvisorReplication = async (input: {
  experimentId?: string;
  concurrency?: number;
  timeoutSeconds?: number;
  validatorTimeoutSeconds?: number;
}) => {
  const experimentId = input.experimentId ?? DEFAULT_EXPERIMENT;
  const concurrency = input.concurrency ?? 4;
  const timeoutSeconds = input.timeoutSeconds ?? 600;
  const validatorTimeoutSeconds = input.validatorTimeoutSeconds ?? 300;
  if (!EXPERIMENT_ID_PATTERN.test(experimentId)) {
    throw new Error(`Invalid experiment ID: ${experimentId}`);
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency must be a positive integer");
  }
  const root = resolve(ARTIFACTS, experimentId);
  const resultsPath = resolve(RESULTS, `${experimentId}.jsonl`);
  if (existsSync(root) || existsSync(resultsPath)) {
    throw new Error(
      `Refusing to overwrite existing experiment: ${experimentId}`
    );
  }
  mkdirSync(root, { recursive: true });
  mkdirSync(RESULTS, { recursive: true });
  const manifest = loadManifest(MANIFEST);
  const config = loadBenchmarkConfig(CONFIG);
  const identity = buildTreatmentIdentity(manifest, config);
  writeAtomic(resolve(root, "treatment-identity.json"), {
    experimentId,
    createdAt: new Date().toISOString(),
    ...identity,
  });
  if (!identity.matches) {
    throw new Error(
      `P0 treatment identity stop: ${Object.entries(identity.referenceChecks)
        .filter(([, value]) => !value)
        .map(([key]) => key)
        .join(", ")}`
    );
  }
  if (manifest.tasks.length !== 20) {
    throw new Error("Expected exactly 20 frozen tasks");
  }
  if (
    config.config.models.frontier.ref !== SOL ||
    config.config.models.small.ref !== LUNA
  ) {
    throw new Error("Model aliases do not match frozen Sol/Luna protocol");
  }
  const schedule = createReplicationSchedule(manifest);
  if (
    schedule.length !== 60 ||
    schedule.some((pair) => pair.entries.length !== 2) ||
    new Set(schedule.map((pair) => pair.pairId)).size !== 60
  ) {
    throw new Error("Expected 60 unique two-cell pair blocks");
  }
  const cells = schedule.flatMap((pair) => pair.entries);
  if (
    cells.length !== 120 ||
    new Set(
      cells.map((entry) => `${entry.taskId}/${entry.mode}/${entry.repetition}`)
    ).size !== 120
  ) {
    throw new Error("Expected exactly one cell per task/mode/repetition");
  }
  if (schedule.some((pair) => pair.entries[0].mode === pair.entries[1].mode)) {
    throw new Error("Pair contains duplicate mode");
  }
  const scheduleSha256 = canonicalJsonHash(schedule);
  const planCore = {
    candidatePoolSha256: identity.current.candidatePoolSha256,
    concurrency,
    experimentId,
    identityHash: identity.identityHash,
    manifestSha256: identity.current.frozenManifestCanonicalSha256,
    modes: ["luna", OPTIONAL],
    pairCount: 60,
    repetitions: REPETITIONS,
    schedule,
    scheduleSha256,
    seed: SEED,
    timeoutSeconds,
    validatorTimeoutSeconds,
    schemaVersion: 1 as const,
  };
  const planSha256 = canonicalJsonHash(planCore);
  const plan = { ...planCore, planSha256 };
  for (const path of [
    "plan.json",
    "schedule.json",
    "provenance.json",
    "preflight.json",
    "chronology.json",
  ]) {
    if (existsSync(resolve(root, path))) {
      throw new Error(`Refusing to overwrite ${path}`);
    }
  }
  const commit = await git(["rev-parse", "HEAD"]);
  writeAtomic(resolve(root, "plan.json"), plan);
  writeAtomic(resolve(root, "schedule.json"), {
    experimentId,
    pairCount: 60,
    pairs: schedule,
    scheduleSha256,
    seed: SEED,
    schemaVersion: 1,
  });
  const provenance = {
    adapterHash: identity.current.adapterHash,
    adapterVersion: ADAPTER_VERSION,
    benchmarkRepositoryCommit: commit,
    candidatePoolSha256: identity.current.candidatePoolSha256,
    concurrency,
    configHash: identity.current.configHash,
    createdAt: new Date().toISOString(),
    experimentId,
    identityHash: identity.identityHash,
    manifestPath: MANIFEST,
    manifestSha256: identity.current.frozenManifestCanonicalSha256,
    models: [LUNA, SOL],
    preflightArtifact: PREFLIGHT_ARTIFACT,
    preflightArtifactSha256: hashFile(PREFLIGHT_ARTIFACT),
    planSha256,
    runtime: {
      architecture: process.arch,
      bun: process.versions.bun ?? "unknown",
      node: process.versions.node,
      platform: process.platform,
    },
    scheduleSha256,
    scheduleSeed: SEED,
    semanticManifestSha256: identity.current.frozenManifestSemanticSha256,
    timeoutSeconds,
    validatorTimeoutSeconds,
  };
  writeAtomic(resolve(root, "provenance.json"), provenance);
  const preflightArtifact = json<{ rows: PreflightRow[] }>(PREFLIGHT_ARTIFACT);
  const preflight = preflightArtifact.rows;
  if (
    preflight.length !== 20 ||
    preflight.some(
      (row) => !manifest.tasks.some((task) => task.id === row.taskId)
    )
  ) {
    throw new Error("Preflight artifact does not cover the frozen manifest");
  }
  writeAtomic(resolve(root, "preflight.json"), {
    artifact: PREFLIGHT_ARTIFACT,
    artifactSha256: hashFile(PREFLIGHT_ARTIFACT),
    experimentId,
    rows: preflight,
  });
  assertPreflight(preflight);
  if (
    preflight.length !== 20 ||
    preflight.some((row: PreflightRow) => !row.ready)
  ) {
    throw new Error("Expected 20/20 ready preflight");
  }
  const inferenceStartedAt = new Date().toISOString();
  writeAtomic(resolve(root, "chronology.json"), {
    experimentId,
    events: [
      { event: "plan-persisted", planSha256, timestamp: provenance.createdAt },
      { event: "inference-start", planSha256, timestamp: inferenceStartedAt },
    ],
    planSha256,
    scheduleSha256,
  });
  const fd = openSync(resultsPath, "wx");
  const records: (SwebenchRunRecord & {
    completionIndex: number;
    pairId: string;
    withinPairOrder: 0 | 1;
  })[] = [];
  let nextPair = 0;
  let completionIndex = 0;
  let stopReason: string | undefined;
  const worker = async () => {
    while (!stopReason) {
      const pairIndex = nextPair++;
      if (pairIndex >= schedule.length) {
        return;
      }
      const pair = schedule[pairIndex];
      for (const entry of pair.entries) {
        if (stopReason) {
          return;
        }
        const task = manifest.tasks.find(
          (candidate) => candidate.id === entry.taskId
        );
        if (!task) {
          throw new Error(`Unknown task ${entry.taskId}`);
        }
        const record = await runOne({
          artifactsRoot: ARTIFACTS,
          cacheRoot: CACHE,
          configPath: CONFIG,
          experimentId,
          model: entry.mode,
          repetition: entry.repetition,
          task,
          timeoutSeconds,
          validatorTimeoutSeconds,
        });
        const enriched = Object.assign(record, {
          completionIndex: completionIndex++,
          pairId: entry.pairId,
          withinPairOrder: entry.withinPairOrder,
        });
        enriched.planSha256 = planSha256;
        enriched.scheduleIndex = entry.index;
        enriched.scheduleSha256 = scheduleSha256;
        records.push(enriched);
        append(fd, enriched);
        if (fatalCategory(record)) {
          stopReason = `${record.primaryCategory} in ${entry.pairId}/${entry.mode}`;
        }
        process.stdout.write(
          `[swebench-optional-advisor-replication] ${records.length}/120 ${entry.pairId} ${entry.mode} ${record.primaryCategory}\n`
        );
      }
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, schedule.length) }, worker)
    );
  } finally {
    closeSync(fd);
  }
  const complete =
    !stopReason &&
    records.length === 120 &&
    schedule.every((pair) =>
      pair.entries.every((entry) =>
        records.some((record) => record.scheduleIndex === entry.index)
      )
    );
  writeAtomic(resolve(root, "reconciliation.json"), {
    complete,
    experimentId,
    planSha256,
    records: records.length,
    scheduleSha256,
    stopReason: stopReason ?? null,
  });
  writeAtomic(resolve(root, "provenance.json"), {
    ...provenance,
    authoritativeTelemetry: {
      advisorCallsFromRuntime: records.reduce(
        (sum, record) => sum + (record.runtime?.advisorCallsObserved ?? 0),
        0
      ),
      advisorCallsFromUsage: records.reduce(
        (sum, record) => sum + (record.usage?.advisor.calls ?? 0),
        0
      ),
    },
    inferenceStartedAt,
    reconciliationPath: resolve(root, "reconciliation.json"),
    stopReason: stopReason ?? null,
  });
  if (!complete) {
    throw new Error(
      `Experiment stopped before 120 terminal cells: ${stopReason ?? "missing schedule records"}`
    );
  }
  return {
    experimentId,
    plan,
    provenance,
    records,
    reportPath: REPORT,
    resultsPath,
    schedule,
  };
};
