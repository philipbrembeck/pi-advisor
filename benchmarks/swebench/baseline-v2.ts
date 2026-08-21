/* biome-ignore-all assist/source/organizeImports: the benchmark runner keeps lifecycle imports grouped by phase. */
/* biome-ignore-all assist/source/useSortedInterfaceMembers: plan records are grouped by execution semantics. */
/* biome-ignore-all assist/source/useSortedKeys: schedule entries preserve the published field order. */
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: benchmark gates remain explicit and auditable. */
/* biome-ignore-all lint/performance/useTopLevelRegex: the experiment ID guard is a one-time execution gate. */
/* biome-ignore-all lint/style/noNestedTernary: schedule construction is a compact two-round complement. */
/* biome-ignore-all lint/style/useBlockStatements: lifecycle guards remain compact and explicit. */
/* biome-ignore-all lint/style/useNumericSeparators: the frozen seed is part of the experiment identity. */
/* biome-ignore-all lint/suspicious/noBitwiseOperators: the deterministic PRNG uses explicit uint32 arithmetic. */
/* biome-ignore-all lint/suspicious/noExplicitAny: JSON artifacts are validated at their domain boundaries. */
/* biome-ignore-all lint/correctness/noUnusedFunctionParameters: plan validation keeps a stable helper signature. */
/* biome-ignore-all lint/performance/noAwaitInLoops: workers serialize their own completion persistence. */
/* biome-ignore-all lint/style/noIncrementDecrement: the atomic scheduler counter is local and bounded. */
/* biome-ignore-all lint/suspicious/noUnnecessaryConditions: the worker loop exits through its explicit schedule sentinel. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { loadBenchmarkConfig } from "../src/config.js";
import { hashText } from "../src/isolation.js";
import { loadManifest } from "./adapter.js";
import {
  canonicalJsonHash,
  semanticManifestIdentity,
} from "./manifest-identity.js";
import { assertPreflight, runOne, runPreflight } from "./runner.js";
import type {
  PreflightRow,
  SwebenchManifest,
  SwebenchRunRecord,
} from "./types.js";

const execFileAsync = promisify(execFile);
const EXPECTED_CANONICAL =
  "44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193";
const EXPECTED_SEMANTIC =
  "f47a191590b8a39880a6770023035e812e8cae886b94a0f16e34e7c59dcbd588";
const EXPECTED_POOL =
  "6282101e12dd1d79667de8f04e45554971d329c9be058b864186fb7394eb9dbb";
const SOL = "openai-codex/gpt-5.6-sol";
const LUNA = "openai-codex/gpt-5.6-luna";
const MODELS = [SOL, LUNA] as const;
const DEFAULT_EXPERIMENT = "exp-20260820-swebench-hard-baseline-v2";
const DEFAULT_MANIFEST = "benchmarks/swebench/hard-baseline-v2-manifest.json";
const DEFAULT_CACHE = "benchmarks/swebench/cache";
const DEFAULT_CONFIG = "benchmarks/config/benchmark.local.json";
const DEFAULT_ARTIFACTS = "benchmarks/swebench/artifacts";
const DEFAULT_RESULTS = "benchmarks/swebench/results";
const DEFAULT_REPORT = "benchmarks/SWEBENCH-HARD-BASELINE-V2-REPORT.md";
const REPEAT_ARTIFACT =
  "benchmarks/swebench/artifacts/hard-baseline-v2/preflight-determinism-sample-final.json";
const SEED = 20260820;

type Model = "sol" | "luna";
interface ScheduleEntry {
  instanceId: string;
  model: Model;
  modelRef: string;
  repetition: 0;
  repo: string;
  scheduleIndex: number;
  taskId: string;
}
interface BaselinePlan {
  candidatePoolSha256: string;
  concurrency: number;
  entries: ScheduleEntry[];
  experimentId: string;
  manifestPath: string;
  manifestSha256: string;
  models: string[];
  planSha256: string;
  scheduleSha256: string;
  schemaVersion: 1;
  seed: number;
  semanticManifestSha256: string;
  timeoutSeconds: number;
  validatorTimeoutSeconds: number;
}

const readJson = (path: string): any =>
  JSON.parse(readFileSync(resolve(path), "utf8"));
const sha256File = (path: string) =>
  hashText(readFileSync(resolve(path), "utf8"));
const writeJsonAtomic = (path: string, value: unknown) => {
  const absolute = resolve(path);
  const temporary = `${absolute}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
  });
  renameSync(temporary, absolute);
};
const random = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};
const shuffled = <T>(items: T[], next: () => number) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};
const modelName = (model: Model) => (model === "sol" ? SOL : LUNA);

const createSchedule = (
  manifest: SwebenchManifest,
  seed: number
): ScheduleEntry[] => {
  const next = random(seed);
  const order = shuffled(manifest.tasks, next);
  const firstModels = new Map(
    order.map((task) => [
      task.id,
      next() < 0.5 ? ("sol" as const) : ("luna" as const),
    ])
  );
  const entries: ScheduleEntry[] = [];
  for (const round of [0, 1]) {
    for (const task of order) {
      const first = firstModels.get(task.id) ?? "sol";
      const model = round === 0 ? first : first === "sol" ? "luna" : "sol";
      entries.push({
        instanceId: task.instanceId,
        model,
        modelRef: modelName(model),
        repetition: 0,
        repo: task.repo,
        scheduleIndex: entries.length,
        taskId: task.id,
      });
    }
  }
  return entries;
};

const git = async (args: string[]) =>
  (
    await execFileAsync("git", args, { maxBuffer: 20 * 1024 * 1024 })
  ).stdout.trim();
const sourceFingerprint = async () => {
  const commit = await git(["rev-parse", "HEAD"]);
  const status = await git(["status", "--porcelain=v1"]);
  const diff = await git(["diff", "HEAD", "--binary"]);
  const paths = (
    await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  )
    .split("\\0")
    .filter(Boolean)
    .sort();
  const snapshot = paths.map((path) => {
    const bytes = readFileSync(resolve(path));
    return {
      mode: statSync(resolve(path)).mode,
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength,
    };
  });
  return {
    commit,
    diffSha256: hashText(diff),
    dirty: status.length > 0,
    fileCount: snapshot.length,
    filesSha256: hashText(JSON.stringify(snapshot)),
    statusSha256: hashText(status),
  };
};

const assertGate = (manifest: SwebenchManifest, poolPath: string) => {
  const provenance = readJson(
    "benchmarks/swebench/artifacts/hard-baseline-v2/selection-provenance.json"
  );
  const canonical = canonicalJsonHash(manifest);
  const semantic = semanticManifestIdentity(manifest, provenance);
  const pool = canonicalJsonHash(readJson(poolPath));
  if (
    canonical !== EXPECTED_CANONICAL ||
    semantic !== EXPECTED_SEMANTIC ||
    pool !== EXPECTED_POOL
  ) {
    throw new Error(
      `P0 integrity stop: canonical=${canonical}, semantic=${semantic}, candidatePool=${pool}`
    );
  }
  if (manifest.tasks.length !== 20)
    throw new Error("P0 integrity stop: manifest is not 20 tasks");
  const byRepo = new Map<string, number>();
  for (const task of manifest.tasks)
    byRepo.set(task.repo, (byRepo.get(task.repo) ?? 0) + 1);
  if (byRepo.size !== 5 || [...byRepo.values()].some((count) => count !== 4)) {
    throw new Error(
      "P0 integrity stop: repository distribution is not 4/4 across five repositories"
    );
  }
  return { canonical, pool, provenance, semantic };
};

const assertDeterminismArtifact = () => {
  const value = readJson(REPEAT_ARTIFACT);
  if (
    !Array.isArray(value.rows) ||
    value.rows.length !== 5 ||
    value.rows.some((row: PreflightRow) => !row.ready)
  ) {
    throw new Error(
      `P0 integrity stop: deterministic repeat artifact is not 5/5 ready: ${REPEAT_ARTIFACT}`
    );
  }
};

const planned = (
  plan: BaselinePlan,
  entry: ScheduleEntry,
  manifest: SwebenchManifest
) => {
  const task = manifest.tasks.find(
    (candidate) => candidate.id === entry.taskId
  );
  if (!task)
    throw new Error(`Schedule references unknown task ${entry.taskId}`);
  return { model: entry.model, task };
};

const appendRecord = (fd: number, record: SwebenchRunRecord) => {
  const line = `${JSON.stringify(record)}\n`;
  writeFileSync(fd, line);
  fsyncSync(fd);
};

export const executeBaselineV2 = async (input: {
  experimentId?: string;
  manifestPath?: string;
  cacheRoot?: string;
  configPath?: string;
  artifactsRoot?: string;
  resultsRoot?: string;
  reportPath?: string;
  concurrency?: number;
  timeoutSeconds?: number;
  validatorTimeoutSeconds?: number;
}) => {
  const experimentId = input.experimentId ?? DEFAULT_EXPERIMENT;
  const manifestPath = input.manifestPath ?? DEFAULT_MANIFEST;
  const cacheRoot = input.cacheRoot ?? DEFAULT_CACHE;
  const configPath = input.configPath ?? DEFAULT_CONFIG;
  const artifactsRoot = input.artifactsRoot ?? DEFAULT_ARTIFACTS;
  const resultsRoot = input.resultsRoot ?? DEFAULT_RESULTS;
  const reportPath = input.reportPath ?? DEFAULT_REPORT;
  const concurrency = input.concurrency ?? 4;
  const timeoutSeconds = input.timeoutSeconds ?? 600;
  const validatorTimeoutSeconds = input.validatorTimeoutSeconds ?? 300;
  if (!/^exp-[a-z0-9-]+$/.test(experimentId))
    throw new Error(`Invalid experiment ID: ${experimentId}`);
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("concurrency must be a positive integer");
  const manifest = loadManifest(manifestPath);
  const gate = assertGate(
    manifest,
    "benchmarks/swebench/artifacts/hard-baseline-v1/candidate-pool.json"
  );
  assertDeterminismArtifact();
  const config = loadBenchmarkConfig(configPath);
  if (
    config.config.models.frontier.ref !== SOL ||
    config.config.models.small.ref !== LUNA
  ) {
    throw new Error(
      "Model identity stop: benchmark config aliases do not match the frozen Sol/Luna IDs"
    );
  }
  const preflightRows = await runPreflight(
    manifest,
    cacheRoot,
    validatorTimeoutSeconds
  );
  assertPreflight(preflightRows);
  const preflightByRepo = new Map<string, number>();
  for (const row of preflightRows)
    if (row.ready)
      preflightByRepo.set(
        row.repo ?? "",
        (preflightByRepo.get(row.repo ?? "") ?? 0) + 1
      );
  if (
    preflightRows.length !== 20 ||
    [...preflightByRepo.values()].some((count) => count !== 4)
  ) {
    throw new Error(
      "Preflight stop: expected 20/20 ready and 4/4 for each repository"
    );
  }
  const schedule = createSchedule(manifest, SEED);
  if (
    schedule.length !== 40 ||
    new Set(schedule.map((entry) => `${entry.taskId}/${entry.model}`)).size !==
      40
  ) {
    throw new Error(
      "Schedule stop: expected exactly one Sol and one Luna entry per task"
    );
  }
  const scheduleSha256 = canonicalJsonHash(schedule);
  const basePlan = {
    candidatePoolSha256: gate.pool,
    concurrency,
    entries: schedule,
    experimentId,
    manifestPath: resolve(manifestPath),
    manifestSha256: gate.canonical,
    models: [...MODELS],
    scheduleSha256,
    schemaVersion: 1 as const,
    seed: SEED,
    semanticManifestSha256: gate.semantic,
    timeoutSeconds,
    validatorTimeoutSeconds,
  };
  const planSha256 = canonicalJsonHash(basePlan);
  const plan: BaselinePlan = { ...basePlan, planSha256 };
  const experimentRoot = resolve(artifactsRoot, experimentId);
  const resultsPath = resolve(resultsRoot, `${experimentId}.jsonl`);
  mkdirSync(experimentRoot, { recursive: true });
  mkdirSync(resolve(resultsRoot), { recursive: true });
  const planPath = resolve(experimentRoot, "plan.json");
  const schedulePath = resolve(experimentRoot, "schedule.json");
  const provenancePath = resolve(experimentRoot, "provenance.json");
  const chronologyPath = resolve(experimentRoot, "chronology.json");
  const reconciliationPath = resolve(experimentRoot, "reconciliation.json");
  for (const path of [
    planPath,
    schedulePath,
    provenancePath,
    chronologyPath,
    reconciliationPath,
    resultsPath,
  ]) {
    if (existsSync(path))
      throw new Error(
        `Refusing to overwrite existing experiment artifact: ${path}`
      );
  }
  const fingerprint = await sourceFingerprint();
  const planPersistedAt = new Date().toISOString();
  const provenance = {
    adapterHash: sha256File("benchmarks/swebench/adapter.ts"),
    adapterVersion: "2026-08-19.3",
    baselineRunnerHash: sha256File("benchmarks/swebench/baseline-v2.ts"),
    benchmarkRepositoryCommit: fingerprint.commit,
    candidatePoolSha256: gate.pool,
    concurrency,
    configHash: config.hash,
    configPath: resolve(configPath),
    createdAt: planPersistedAt,
    planPersistedAt,
    determinismRepeat: { artifact: REPEAT_ARTIFACT, ready: 5, rows: 5 },
    experimentId,
    manifestPath: resolve(manifestPath),
    manifestSha256: gate.canonical,
    modelIds: [...MODELS],
    planSha256,
    preflight: {
      byRepository: Object.fromEntries(preflightByRepo),
      ready: 20,
      rows: 20,
    },
    runnerHash: sha256File("benchmarks/swebench/runner.ts"),
    runtime: {
      architecture: process.arch,
      bun: process.versions.bun ?? "unknown",
      node: process.versions.node,
      platform: process.platform,
    },
    scheduleSha256,
    schemaVersion: 1,
    seed: SEED,
    semanticManifestSha256: gate.semantic,
    sourceTree: fingerprint,
    timeoutSeconds,
    validatorTimeoutSeconds,
  };
  writeJsonAtomic(planPath, plan);
  writeJsonAtomic(schedulePath, {
    entries: schedule,
    experimentId,
    scheduleSha256,
    schemaVersion: 1,
    seed: SEED,
  });
  writeJsonAtomic(resolve(experimentRoot, "preflight.json"), {
    experimentId,
    rows: preflightRows,
  });
  writeJsonAtomic(provenancePath, provenance);
  const inferenceStartedAt = new Date().toISOString();
  writeJsonAtomic(chronologyPath, {
    experimentId,
    events: [
      { event: "plan-persisted", planSha256, timestamp: planPersistedAt },
      { event: "inference-start", planSha256, timestamp: inferenceStartedAt },
    ],
    planSha256,
    scheduleSha256,
  });
  writeJsonAtomic(provenancePath, {
    ...provenance,
    inferenceStartedAt,
  });
  const fd = openSync(resultsPath, "wx");
  const records: SwebenchRunRecord[] = [];
  let next = 0;
  let completionIndex = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= schedule.length) return;
      const entry = schedule[index];
      const target = planned(plan, entry, manifest);
      const record = await runOne({
        artifactsRoot,
        cacheRoot,
        configPath,
        experimentId,
        model: target.model,
        repetition: 0,
        task: target.task,
        timeoutSeconds,
        validatorTimeoutSeconds,
      });
      record.planSha256 = planSha256;
      record.scheduleIndex = entry.scheduleIndex;
      record.scheduleSha256 = scheduleSha256;
      (
        record as SwebenchRunRecord & { completionIndex: number }
      ).completionIndex = completionIndex++;
      records.push(record);
      appendRecord(fd, record);
      process.stdout.write(
        `[swebench-baseline-v2] ${records.length}/40 ${entry.taskId} ${entry.model} ${record.primaryCategory}\n`
      );
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, schedule.length) }, worker)
    );
  } finally {
    closeSync(fd);
  }
  const reconciliation = schedule.map((entry) => {
    const record = records.find(
      (candidate) => candidate.scheduleIndex === entry.scheduleIndex
    );
    if (!record)
      throw new Error(
        `Missing terminal record for schedule index ${entry.scheduleIndex}`
      );
    const patchPath = resolve(record.modelPatch.artifactPath);
    return {
      artifactPath: record.modelPatch.artifactPath,
      artifactSha256: sha256File(record.modelPatch.artifactPath),
      hasPatchArtifact: existsSync(patchPath),
      model: entry.model,
      noOpPatch: record.modelPatch.diffBytes === 0,
      primaryCategory: record.primaryCategory,
      resultExecutionId: record.executionId,
      scheduleIndex: entry.scheduleIndex,
      taskId: entry.taskId,
      terminal: true,
      usageAvailable: record.usage?.executor.usageAvailable ?? false,
    };
  });
  writeJsonAtomic(reconciliationPath, {
    experimentId,
    complete:
      reconciliation.length === 40 &&
      reconciliation.every((row) => row.terminal && row.hasPatchArtifact),
    planSha256,
    rows: reconciliation,
    scheduleSha256,
  });
  writeJsonAtomic(provenancePath, {
    ...provenance,
    authoritativeTelemetry: {
      advisorCallsFromRuntime: records.reduce(
        (sum, record) => sum + (record.runtime?.advisorCallsObserved ?? 0),
        0
      ),
      advisorEvents: records.reduce(
        (sum, record) =>
          sum +
          (record.trajectoryEvents?.filter((event) => event.type === "advisor")
            .length ?? 0),
        0
      ),
      scoutCallsFromUsage: records.reduce(
        (sum, record) => sum + (record.usage?.scout.calls ?? 0),
        0
      ),
    },
    inferenceStartedAt,
    reconciliationPath,
  });
  return { experimentId, plan, provenance, records, reportPath, resultsPath };
};

export const baselineDefaults = {
  artifactsRoot: DEFAULT_ARTIFACTS,
  cacheRoot: DEFAULT_CACHE,
  configPath: DEFAULT_CONFIG,
  manifestPath: DEFAULT_MANIFEST,
  reportPath: DEFAULT_REPORT,
  resultsRoot: DEFAULT_RESULTS,
};
