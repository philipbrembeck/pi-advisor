/* biome-ignore-all assist/source/organizeImports: experiment lifecycle imports are grouped by phase. */
/* biome-ignore-all assist/source/useSortedKeys: persisted artifacts follow protocol order. */
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: every paid-run gate remains explicit. */
/* biome-ignore-all lint/performance/noAwaitInLoops: each bounded worker persists its own terminal result. */
/* biome-ignore-all lint/style/useBlockStatements: lifecycle guards remain compact. */
/* biome-ignore-all lint/style/noIncrementDecrement: the local scheduler counter is atomic within one process. */
/* biome-ignore-all lint/suspicious/noBitwiseOperators: the deterministic PRNG uses explicit uint32 arithmetic. */
/* biome-ignore-all lint/performance/useTopLevelRegex: the experiment ID guard is a one-time gate. */
/* biome-ignore-all lint/suspicious/noUnnecessaryConditions: worker loops exit through their schedule sentinel. */
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
import { activeToolsForMode } from "../src/profile.js";
import { hashText } from "../src/isolation.js";
import { loadManifest } from "./adapter.js";
import {
  canonicalJsonHash,
  semanticManifestIdentity,
} from "./manifest-identity.js";
import { assertPreflight, runOne, runPreflight } from "./runner.js";
import type { SwebenchManifest, SwebenchRunRecord } from "./types.js";

const execFileAsync = promisify(execFile);
const SOL = "openai-codex/gpt-5.6-sol";
const LUNA = "openai-codex/gpt-5.6-luna";
const OPTIONAL = "luna-advisor-optional" as const;
const DEFAULT_EXPERIMENT = "exp-20260820-swebench-hard-optional-advisor-v1";
const MANIFEST = "benchmarks/swebench/hard-baseline-v2-manifest.json";
const POOL =
  "benchmarks/swebench/artifacts/hard-baseline-v1/candidate-pool.json";
const PROVENANCE =
  "benchmarks/swebench/artifacts/hard-baseline-v2/selection-provenance.json";
const CACHE = "benchmarks/swebench/cache";
const CONFIG = "benchmarks/config/benchmark.local.json";
const ARTIFACTS = "benchmarks/swebench/artifacts";
const RESULTS = "benchmarks/swebench/results";
const REPORT = "benchmarks/SWEBENCH-HARD-OPTIONAL-ADVISOR-V1-REPORT.md";
const CANONICAL =
  "44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193";
const SEMANTIC =
  "f47a191590b8a39880a6770023035e812e8cae886b94a0f16e34e7c59dcbd588";
const CANDIDATE_POOL =
  "6282101e12dd1d79667de8f04e45554971d329c9be058b864186fb7394eb9dbb";
const SEED = 20_260_821;

type Mode = "luna" | typeof OPTIONAL;
interface Entry {
  index: number;
  instanceId: string;
  mode: Mode;
  model: string;
  repetition: 0;
  repo: string;
  taskId: string;
}
const json = <T>(path: string) =>
  JSON.parse(readFileSync(resolve(path), "utf8")) as T;
const hashFile = (path: string) =>
  hashText(readFileSync(resolve(path), "utf8"));
const writeAtomic = (path: string, value: unknown) => {
  const target = resolve(path);
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
  });
  renameSync(temporary, target);
};
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
const modelFor = (mode: Mode) => (mode === "luna" ? LUNA : LUNA);

const runtimeProfile = (mode: Mode, tools: string[]) => {
  const policy = modePolicy(mode);
  return {
    activeTools: activeToolsForMode(mode, tools),
    advisor: mode === OPTIONAL ? SOL : null,
    advisorMaxCallsPerSession: mode === OPTIONAL ? 4 : 0,
    advisorOrchestration: {
      autoLoopGate: false,
      completionGate: false,
      failureGate: false,
      planGate: false,
      scoutEnabled: false,
    },
    executor: LUNA,
    promptTreatment: "exact frozen task prompt; no benchmark treatment suffix",
    policy: {
      advisorCallPolicy: policy.advisorCallPolicy,
      advisorToolAvailable: policy.advisorToolAvailable,
      advisorTrustPolicy: policy.advisorTrustPolicy,
      scoutAvailable: policy.scoutAvailable,
    },
  };
};
const runtimeProof = (tools: string[]) => {
  const luna = runtimeProfile("luna", tools);
  const optional = runtimeProfile(OPTIONAL, tools);
  const allowed = [
    "activeTools adds ask_advisor",
    "advisor assignment changes from null to Sol",
    "advisorMaxCallsPerSession changes from 0 to 4",
    "advisor policy changes from none to optional",
  ];
  const unexpected: string[] = [];
  for (const key of [
    "executor",
    "promptTreatment",
    "advisorOrchestration",
  ] as const) {
    if (JSON.stringify(luna[key]) !== JSON.stringify(optional[key]))
      unexpected.push(key);
  }
  if (optional.policy.advisorCallPolicy !== "optional")
    unexpected.push("optional policy is not optional");
  if (optional.policy.advisorToolAvailable !== true)
    unexpected.push("ask_advisor is unavailable");
  if (optional.policy.scoutAvailable !== false)
    unexpected.push("Scout is available");
  return {
    allowedDifferences: allowed,
    baseline: luna,
    optional,
    unexpectedDifferences: unexpected,
  };
};
const scheduleFor = (manifest: SwebenchManifest) => {
  const next = rng(SEED);
  const tasks = shuffle(manifest.tasks, next);
  const entries: Entry[] = [];
  for (const round of [0, 1]) {
    for (const task of tasks) {
      const mode: Mode = round === 0 ? "luna" : OPTIONAL;
      entries.push({
        index: entries.length,
        instanceId: task.instanceId,
        mode,
        model: modelFor(mode),
        repetition: 0,
        repo: task.repo,
        taskId: task.id,
      });
    }
  }
  return entries;
};
const append = (fd: number, record: SwebenchRunRecord) => {
  writeFileSync(fd, `${JSON.stringify(record)}\n`);
  fsyncSync(fd);
};
const git = async (args: string[]) =>
  (
    await execFileAsync("git", args, { maxBuffer: 20 * 1024 * 1024 })
  ).stdout.trim();

export const executeOptionalAdvisorV1 = async (input: {
  experimentId?: string;
  concurrency?: number;
  timeoutSeconds?: number;
  validatorTimeoutSeconds?: number;
}) => {
  const experimentId = input.experimentId ?? DEFAULT_EXPERIMENT;
  const concurrency = input.concurrency ?? 4;
  const timeoutSeconds = input.timeoutSeconds ?? 600;
  const validatorTimeoutSeconds = input.validatorTimeoutSeconds ?? 300;
  if (!/^exp-[a-z0-9-]+$/.test(experimentId))
    throw new Error(`Invalid experiment ID: ${experimentId}`);
  const manifest = loadManifest(MANIFEST);
  const provenance = json<Record<string, unknown>>(PROVENANCE);
  const canonical = canonicalJsonHash(manifest);
  const semantic = semanticManifestIdentity(manifest, provenance);
  const pool = canonicalJsonHash(json(POOL));
  if (
    canonical !== CANONICAL ||
    semantic !== SEMANTIC ||
    pool !== CANDIDATE_POOL
  )
    throw new Error("Frozen integrity gate failed");
  const config = loadBenchmarkConfig(CONFIG);
  if (
    config.config.models.frontier.ref !== SOL ||
    config.config.models.small.ref !== LUNA
  )
    throw new Error("Model aliases do not match Sol/Luna protocol");
  const preflight = await runPreflight(
    manifest,
    CACHE,
    validatorTimeoutSeconds
  );
  assertPreflight(preflight);
  if (preflight.length !== 20 || preflight.some((row) => !row.ready))
    throw new Error("Expected 20/20 ready preflight");
  const proof = runtimeProof(config.config.execution.tools);
  if (proof.unexpectedDifferences.length)
    throw new Error(
      `Runtime-equivalence stop: ${proof.unexpectedDifferences.join(", ")}`
    );
  const entries = scheduleFor(manifest);
  if (
    entries.length !== 40 ||
    new Set(entries.map((entry) => `${entry.taskId}/${entry.mode}`)).size !== 40
  )
    throw new Error("Expected one Luna and one optional-Advisor cell per task");
  const scheduleSha256 = canonicalJsonHash(entries);
  const planCore = {
    candidatePoolSha256: pool,
    concurrency,
    experimentId,
    manifestSha256: canonical,
    modes: ["luna", OPTIONAL],
    semanticManifestSha256: semantic,
    entries,
    scheduleSha256,
    seed: SEED,
    timeoutSeconds,
    validatorTimeoutSeconds,
    schemaVersion: 1 as const,
  };
  const planSha256 = canonicalJsonHash(planCore);
  const plan = { ...planCore, planSha256 };
  const root = resolve(ARTIFACTS, experimentId);
  const resultsPath = resolve(RESULTS, `${experimentId}.jsonl`);
  const planPath = resolve(root, "plan.json");
  const schedulePath = resolve(root, "schedule.json");
  const proofPath = resolve(root, "runtime-equivalence.json");
  const provenancePath = resolve(root, "provenance.json");
  const preflightPath = resolve(root, "preflight.json");
  for (const path of [
    planPath,
    schedulePath,
    proofPath,
    provenancePath,
    preflightPath,
    resultsPath,
  ])
    if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(RESULTS, { recursive: true });
  const commit = await git(["rev-parse", "HEAD"]);
  const runProvenance = {
    adapterHash: hashFile("benchmarks/swebench/adapter.ts"),
    adapterVersion: "2026-08-19.3",
    benchmarkRepositoryCommit: commit,
    candidatePoolSha256: pool,
    concurrency,
    configHash: config.hash,
    createdAt: new Date().toISOString(),
    experimentId,
    manifestPath: MANIFEST,
    manifestSha256: canonical,
    models: [LUNA, SOL],
    planSha256,
    runtime: {
      architecture: process.arch,
      bun: process.versions.bun ?? "unknown",
      node: process.versions.node,
      platform: process.platform,
    },
    scheduleSeed: SEED,
    scheduleSha256,
    semanticManifestSha256: semantic,
    timeoutSeconds,
    validatorTimeoutSeconds,
  };
  writeAtomic(planPath, plan);
  writeAtomic(schedulePath, {
    entries,
    experimentId,
    scheduleSha256,
    seed: SEED,
    schemaVersion: 1,
  });
  writeAtomic(proofPath, proof);
  writeAtomic(preflightPath, { experimentId, rows: preflight });
  writeAtomic(provenancePath, runProvenance);
  const fd = openSync(resultsPath, "wx");
  const records: SwebenchRunRecord[] = [];
  let cursor = 0;
  let completion = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= entries.length) return;
      const entry = entries[index];
      const task = manifest.tasks.find(
        (candidate) => candidate.id === entry.taskId
      );
      if (!task) throw new Error(`Unknown task ${entry.taskId}`);
      const record = await runOne({
        artifactsRoot: ARTIFACTS,
        cacheRoot: CACHE,
        configPath: CONFIG,
        experimentId,
        model: entry.mode,
        repetition: 0,
        task,
        timeoutSeconds,
        validatorTimeoutSeconds,
      });
      record.planSha256 = planSha256;
      record.scheduleIndex = entry.index;
      record.scheduleSha256 = scheduleSha256;
      (
        record as SwebenchRunRecord & { completionIndex: number }
      ).completionIndex = completion++;
      records.push(record);
      append(fd, record);
      process.stdout.write(
        `[swebench-optional-advisor-v1] ${records.length}/40 ${entry.taskId} ${entry.mode} ${record.primaryCategory}\n`
      );
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, entries.length) }, worker)
    );
  } finally {
    closeSync(fd);
  }
  return {
    experimentId,
    plan,
    proof,
    provenance: runProvenance,
    records,
    reportPath: REPORT,
    resultsPath,
  };
};
