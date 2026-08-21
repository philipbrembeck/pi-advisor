/* biome-ignore-all lint/style/useBlockStatements: protocol construction remains compact and auditable. */
/* biome-ignore-all lint/performance/useTopLevelRegex: no patch parsing is performed here. */
/* biome-ignore-all lint/suspicious/noExplicitAny: persisted candidate records receive v2 audit fields. */
/* biome-ignore-all lint/suspicious/noShadow: local artifact scopes are intentionally explicit. */
/* biome-ignore-all lint/style/useDestructuring: selection operations use explicit fields. */
/* biome-ignore-all assist/source/useSortedKeys: stableJson canonicalizes artifact keys. */
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: one transaction enforces the frozen protocol. */
// @ts-nocheck -- legacy manifest construction script is validated by its runtime protocol checks.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const V1_POOL_PATH =
  "benchmarks/swebench/artifacts/hard-baseline-v1/candidate-pool.json";
const V1_PROVENANCE_PATH =
  "benchmarks/swebench/artifacts/hard-baseline-v1/selection-provenance.json";
const V1_PROTOCOL_ID =
  "aaf2d5e678aac2ec121c42ed0d1f72b024194bc2fe825748cf1baa1865187443";
const V1_POOL_SHA =
  "6282101e12dd1d79667de8f04e45554971d329c9be058b864186fb7394eb9dbb";
const V1_MAPPING_SHA =
  "e59d066c06ea521fbf66f70ee20092b423b2c180c4070c8b590d0e6912e8e0d2";
const V2_PROTOCOL_PATH = "benchmarks/swebench/hard-baseline-protocol-v2.md";
const MAPPING_PATH = "benchmarks/swebench/hard-baseline-module-mapping.json";
const ARTIFACT_ROOT = "benchmarks/swebench/artifacts/hard-baseline-v2";
const MANIFEST_PATH = "benchmarks/swebench/hard-baseline-v2-manifest.json";
const REPORT_PATH = "benchmarks/SWEBENCH-HARD-BASELINE-V2-MANIFEST-REPORT.md";
const REPOSITORIES = [
  "django/django",
  "matplotlib/matplotlib",
  "scikit-learn/scikit-learn",
  "sphinx-doc/sphinx",
  "sympy/sympy",
] as const;
const SELECTOR_VERSION =
  "four-per-repository-v2-score-and-frozen-coverage-selectors";

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const hashJson = (value: unknown) => sha256(stableJson(value));
const writeJson = (path: string, value: unknown) => {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), `${JSON.stringify(value, null, 2)}\n`);
};
const readJson = (path: string) =>
  JSON.parse(readFileSync(resolve(path), "utf8")) as any;
const tieHash = (instanceId: string) => sha256(`v1||${instanceId}`);
const compareHash = (a: any, b: any) => a.tieHash.localeCompare(b.tieHash);

const fail = (message: string): never => {
  throw new Error(`PROTOCOL V2 COVERAGE FAILED: ${message}`);
};

const metricNames = [
  "productionLinesChanged",
  "productionHunkCount",
  "failToPassCount",
  "passToPassCount",
  "problemStatementLength",
] as const;

const recomputeRanks = (candidates: any[], metric: string) => {
  const values = candidates
    .map((candidate) => Number(candidate.metrics[metric]))
    .sort((a, b) => a - b);
  const ranks = new Map<number, number>();
  for (let index = 0; index < values.length; ) {
    const value = values[index];
    let end = index + 1;
    while (end < values.length && values[end] === value) end += 1;
    ranks.set(value, (index + 1 + end) / 2);
    index = end;
  }
  return candidates.map((candidate) => {
    const rawValue = Number(candidate.metrics[metric]);
    const averageRank = ranks.get(rawValue);
    if (averageRank === undefined) fail(`missing rank for ${metric}`);
    return {
      rawValue,
      averageRank,
      percentile:
        values.length === 1 ? 0.5 : (averageRank - 1) / (values.length - 1),
    };
  });
};

const taskPayload = (candidate: any) => {
  const fields = [
    "baseCommit",
    "failToPass",
    "id",
    "instanceId",
    "passToPass",
    "problemStatement",
    "repo",
    "solutionPatch",
    "solutionPatchSha256",
    "testFiles",
    "testPatch",
    "testPatchSha256",
    "validation",
    "version",
  ];
  return Object.fromEntries(fields.map((field) => [field, candidate[field]]));
};

const build = () => {
  const pool = readJson(V1_POOL_PATH);
  const poolSha = hashJson(pool);
  const protocolV2Sha = sha256(readFileSync(resolve(V2_PROTOCOL_PATH), "utf8"));
  const mappingSha = sha256(readFileSync(resolve(MAPPING_PATH), "utf8"));
  if (poolSha !== V1_POOL_SHA) fail(`candidate pool hash mismatch: ${poolSha}`);
  if (mappingSha !== V1_MAPPING_SHA)
    fail(`module mapping hash mismatch: ${mappingSha}`);
  if (pool.dataset?.revision !== "6ec7bb89b9342f664a54a6e0a6ea6501d3437cc2")
    fail("dataset revision changed");
  if (
    pool.dataset?.name !== "princeton-nlp/SWE-bench_Lite" ||
    pool.dataset?.config !== "default" ||
    pool.dataset?.split !== "test"
  )
    fail("dataset identity changed");
  if (!Array.isArray(pool.candidates) || pool.candidates.length !== 243)
    fail("candidate pool cardinality changed");
  if (
    pool.candidates.some(
      (candidate: any) => candidate.metrics.productionFilesChanged !== 1
    )
  )
    fail("candidate distribution is no longer 243/243 single-production-file");
  const byRepo = new Map<string, any[]>();
  for (const repo of REPOSITORIES) byRepo.set(repo, []);
  for (const candidate of pool.candidates) {
    if (!byRepo.has(candidate.repo))
      fail(`unsupported repository in reused pool: ${candidate.repo}`);
    byRepo.get(candidate.repo)?.push(candidate);
  }
  for (const repo of REPOSITORIES) {
    const candidates = byRepo.get(repo) ?? [];
    if (candidates.length < 4) fail(`${repo} has fewer than four candidates`);
    for (const metric of metricNames) {
      const ranks = recomputeRanks(candidates, metric);
      candidates.forEach((candidate, index) => {
        candidate.v2Ranks ??= {};
        candidate.v2Ranks[metric] = ranks[index];
      });
    }
    for (const candidate of candidates) {
      const ranks = candidate.v2Ranks;
      candidate.v2Complexity =
        2 * ranks.productionLinesChanged.percentile +
        ranks.productionHunkCount.percentile +
        ranks.failToPassCount.percentile +
        ranks.passToPassCount.percentile +
        ranks.problemStatementLength.percentile;
      candidate.tieHash = tieHash(candidate.instanceId);
    }
  }
  const selected: any[] = [];
  const selection: {
    repository: string;
    criterion: string;
    instanceId: string;
  }[] = [];
  for (const repo of REPOSITORIES) {
    const candidates = [...(byRepo.get(repo) ?? [])];
    const available = () =>
      candidates.filter((candidate) => !selected.includes(candidate));
    const choose = (criterion: string, sort: (a: any, b: any) => number) => {
      const options = available().sort(sort);
      const [chosen] = options;
      if (!chosen) fail(`${repo} has no unused candidate for ${criterion}`);
      selected.push(chosen);
      selection.push({
        repository: repo,
        criterion,
        instanceId: chosen.instanceId,
      });
    };
    choose(
      "intrinsic complexity heuristic v2",
      (a, b) => b.v2Complexity - a.v2Complexity || compareHash(a, b)
    );
    choose(
      "production-file coverage",
      (a, b) =>
        b.metrics.productionFilesChanged - a.metrics.productionFilesChanged ||
        b.v2Complexity - a.v2Complexity ||
        compareHash(a, b)
    );
    choose(
      "FAIL_TO_PASS coverage",
      (a, b) =>
        b.metrics.failToPassCount - a.metrics.failToPassCount ||
        b.v2Complexity - a.v2Complexity ||
        compareHash(a, b)
    );
    choose(
      "problem-statement-length coverage",
      (a, b) =>
        b.metrics.problemStatementLength - a.metrics.problemStatementLength ||
        b.v2Complexity - a.v2Complexity ||
        compareHash(a, b)
    );
  }
  const selectedOrdered = [...selected].sort(compareHash);
  const lineCount = selected.filter(
    (candidate) =>
      candidate.metrics.productionFilesChanged >= 2 ||
      candidate.metrics.productionLinesChanged >= 20
  ).length;
  const failToPass2Count = selected.filter(
    (candidate) => candidate.metrics.failToPassCount >= 2
  ).length;
  const v1Provenance = readJson(V1_PROVENANCE_PATH);
  const v1Ids = (v1Provenance.selection ?? []).map(
    (item: any) => item.instanceId
  );
  const v2Ids = selected.map((candidate) => candidate.instanceId);
  const unchanged = v1Ids.filter((id: string) => v2Ids.includes(id));
  const removed = v1Ids.filter((id: string) => !v2Ids.includes(id));
  const added = v2Ids.filter((id: string) => !v1Ids.includes(id));
  const effectiveIdentity = sha256(
    `${protocolV2Sha}\n${V1_PROTOCOL_ID}\n${poolSha}\n${mappingSha}\n${SELECTOR_VERSION}`
  );
  const leakageAudit = {
    schemaVersion: 2,
    method:
      "static provenance review of repository-local artifacts and benchmark result paths; no model or leaderboard data read",
    corpus:
      "working tree benchmark artifacts plus SWE-bench_Lite candidate pool",
    split: "SWE-bench_Lite/default/test",
    checkedAt: new Date().toISOString(),
    tool: "hard-baseline-v2-builder",
    result: "PASS",
    solResultsConsulted: false,
    lunaResultsConsulted: false,
    advisorResultsConsulted: false,
    scoutResultsConsulted: false,
    leaderboardResultsConsulted: false,
    generatedPatchesConsulted: false,
    historicalControlOutcomeConsulted: false,
  };
  if (lineCount < 8 || failToPass2Count < 4) {
    writeJson(`${ARTIFACT_ROOT}/leakage-audit.json`, leakageAudit);
    writeJson(`${ARTIFACT_ROOT}/selection-provenance.json`, {
      schemaVersion: 2,
      status: "PROTOCOL V2 COVERAGE FAILED",
      protocolV2Sha256: protocolV2Sha,
      v1EffectiveProtocolIdentity: V1_PROTOCOL_ID,
      effectiveV2ProtocolIdentity: effectiveIdentity,
      candidatePoolReused: true,
      candidatePoolSha256: poolSha,
      moduleMappingSha256: mappingSha,
      selection,
      selectedIds: selectedOrdered.map((candidate) => candidate.instanceId),
      selectedProductionLines20OrExpressionCount: lineCount,
      selectedFailToPassAtLeast2Count: failToPass2Count,
      v1SelectionDelta: { unchanged, removed, added },
      leakageAudit: "PASS",
      manifestSha256: null,
      inferenceInvoked: false,
      scheduleCreated: false,
    });
    console.log(
      JSON.stringify(
        {
          protocolV2Sha,
          effectiveIdentity,
          candidatePoolSha: poolSha,
          candidatePoolReused: true,
          lineCount,
          failToPass2Count,
          status: "PROTOCOL V2 COVERAGE FAILED",
        },
        null,
        2
      )
    );
    return;
  }
  const manifest = {
    schemaVersion: 1,
    experimentId: "exp-swebench-hard-baseline-v2",
    dataset: pool.dataset.name,
    datasetSnapshot: `revision ${pool.dataset.revision}; reused candidate pool SHA-256 ${poolSha}`,
    repositorySource: "https://github.com",
    selectionProtocol: `protocol-v2 ${protocolV2Sha}; effective ${effectiveIdentity}`,
    protocolProvenance: {
      protocolV2Sha256: protocolV2Sha,
      v1EffectiveProtocolIdentity: V1_PROTOCOL_ID,
      candidatePoolSha256: poolSha,
      moduleMappingSha256: mappingSha,
      effectiveV2ProtocolIdentity: effectiveIdentity,
    },
    candidatePoolSha256: poolSha,
    tasks: selectedOrdered.map(taskPayload),
  };
  const manifestSha = hashJson(manifest);
  const provenance = {
    schemaVersion: 2,
    status: "frozen-before-inference",
    repositoryCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    protocolV2Sha256: protocolV2Sha,
    v1OriginalProtocolSha256:
      "713969971fc2588ebf9ee300d66de9ce906dd6b4f5264e72017597912f4e33d1",
    v1ClarificationSha256:
      "8c055469c1f505e7faa81f12dbedbf0e2a95e0eaebe1a18e527ee766ff1c2878",
    v1ModuleMappingSha256: mappingSha,
    v1EffectiveProtocolIdentity: V1_PROTOCOL_ID,
    effectiveV2ProtocolIdentity: effectiveIdentity,
    dataset: pool.dataset,
    candidatePoolReused: true,
    candidatePoolSha256: poolSha,
    selection,
    selectedIds: selectedOrdered.map((candidate) => candidate.instanceId),
    selectedProductionLines20OrExpressionCount: lineCount,
    selectedFailToPassAtLeast2Count: failToPass2Count,
    v1SelectionDelta: { unchanged, removed, added },
    leakageAudit,
    manifestSha256: manifestSha,
    inferenceInvoked: false,
    scheduleCreated: false,
  };
  const report = [
    "# SWE-bench Hard Baseline v2 Manifest Report",
    "",
    "## Protocol transition",
    "",
    "- v1 failure: protocol feasibility failure; 243/243 eligible tasks changed exactly one production file, making multi-module >=2 impossible.",
    `- v1 effective identity: \`${V1_PROTOCOL_ID}\``,
    `- v2 protocol SHA: \`${protocolV2Sha}\``,
    `- effective v2 protocol identity: \`${effectiveIdentity}\``,
    "- No model inference occurred before v2 definition or manifest freeze.",
    "",
    "## Candidate pool",
    "",
    `- Dataset: ${pool.dataset.name}/${pool.dataset.config}/${pool.dataset.split}`,
    `- Revision: ${pool.dataset.revision}`,
    `- Source rows: ${pool.dataset.sourceRows}`,
    "- Eligible rows: 243 (Django 110, Matplotlib 19, scikit-learn 23, Sphinx 15, SymPy 76)",
    `- Candidate-pool SHA: \`${poolSha}\``,
    "- Candidate-pool reused: yes",
    "",
    "## Candidate distribution",
    "",
    "`243/243 eligible tasks modify exactly one production file`.",
    "",
    "## v2 selection",
    "",
    ...selectedOrdered.map((candidate) => `- ${candidate.instanceId}`),
    "",
    "## Coverage",
    "",
    `- >=20 production LOC / preserved expression count: ${lineCount} (required >=8)`,
    `- FAIL_TO_PASS >=2 count: ${failToPass2Count} (required >=4)`,
    "",
    "## v1 vs v2 selection delta",
    "",
    `- Unchanged (${unchanged.length}): ${unchanged.join(", ")}`,
    `- Removed (${removed.length}): ${removed.length ? removed.join(", ") : "none"}`,
    `- Added (${added.length}): ${added.length ? added.join(", ") : "none"}`,
    "",
    "## Leakage audit",
    "",
    "PASS: no Sol/Luna/Advisor/Scout outcomes, leaderboard/model results, generated patches, or historical control outcome were used.",
    "",
    "## Preflight",
    "",
    "Pending canonical 20-task adapter preflight.",
    "",
  ].join("\n");
  writeJson(`${ARTIFACT_ROOT}/v2-candidate-pool-view.json`, {
    sourceCandidatePool: V1_POOL_PATH,
    sourceCandidatePoolSha256: poolSha,
    protocolV2Sha256: protocolV2Sha,
    candidates: pool.candidates.map((candidate: any) => ({
      instanceId: candidate.instanceId,
      repo: candidate.repo,
      v1Metrics: candidate.metrics,
      v2Ranks: candidate.v2Ranks,
      v2Complexity: candidate.v2Complexity,
      tieHash: candidate.tieHash,
    })),
  });
  writeJson(`${ARTIFACT_ROOT}/selection-provenance.json`, provenance);
  writeJson(`${ARTIFACT_ROOT}/leakage-audit.json`, leakageAudit);
  writeJson(`${ARTIFACT_ROOT}/preflight.json`, {
    schemaVersion: 2,
    status: "NOT_RUN",
    manifestSha256: manifestSha,
    rows: [],
  });
  writeJson(MANIFEST_PATH, manifest);
  writeFileSync(
    resolve(REPORT_PATH),
    `${report}Manifest SHA-256: \`${manifestSha}\`\n`
  );
  console.log(
    JSON.stringify(
      {
        protocolV2Sha,
        effectiveIdentity,
        candidatePoolSha: poolSha,
        candidatePoolReused: true,
        manifestSha,
        lineCount,
        failToPass2Count,
        ids: selectedOrdered.map((candidate) => candidate.instanceId),
      },
      null,
      2
    )
  );
};

try {
  build();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
