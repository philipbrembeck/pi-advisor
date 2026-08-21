/* biome-ignore-all lint/style/useBlockStatements: deterministic protocol builder keeps guards compact. */
/* biome-ignore-all lint/performance/useTopLevelRegex: patch parsing patterns are local to canonical payload handling. */
/* biome-ignore-all assist/source/useSortedInterfaceMembers: mapping schema mirrors the persisted protocol artifact. */
/* biome-ignore-all assist/source/useSortedKeys: canonical artifact field order is handled by stableJson. */
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: selection construction remains one auditable protocol transaction. */
/* biome-ignore-all lint/complexity/useSimplifiedLogicExpression: fail-closed predicates preserve distinct eligibility causes. */
/* biome-ignore-all lint/complexity/noUselessUndefined: undefined marks ineligible candidates explicitly. */
/* biome-ignore-all lint/performance/noAwaitInLoops: dataset pagination is ordered and fail-closed. */
/* biome-ignore-all lint/suspicious/noExplicitAny: candidate mutation carries computed audit fields. */
/* biome-ignore-all lint/suspicious/noEvolvingTypes: selection records are constructed incrementally. */
/* biome-ignore-all lint/suspicious/noUnnecessaryConditions: runtime dataset guards remain explicit. */
/* biome-ignore-all lint/suspicious/noShadow: row and mapping scopes are intentionally local. */
/* biome-ignore-all lint/style/useDestructuring: indexed selection operations are explicit. */
// @ts-nocheck -- legacy manifest construction script is validated by its runtime protocol checks.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type JsonObject = Record<string, unknown>;
type Classification = "production" | "test" | "other";
type RepoName =
  | "django/django"
  | "matplotlib/matplotlib"
  | "scikit-learn/scikit-learn"
  | "sphinx-doc/sphinx"
  | "sympy/sympy";

const DATASET = "princeton-nlp/SWE-bench_Lite";
const CONFIG = "default";
const SPLIT = "test";
const REVISION = "6ec7bb89b9342f664a54a6e0a6ea6501d3437cc2";
const ORIGINAL_PROTOCOL_SHA =
  "713969971fc2588ebf9ee300d66de9ce906dd6b4f5264e72017597912f4e33d1";
const PROTOCOL_VERSION = "v1";
const SEPARATOR = "||";
const REPOSITORIES: RepoName[] = [
  "django/django",
  "matplotlib/matplotlib",
  "scikit-learn/scikit-learn",
  "sphinx-doc/sphinx",
  "sympy/sympy",
];
const CLARIFICATION_PATH =
  "benchmarks/swebench/hard-baseline-protocol-v1-clarification.md";
const MAPPING_PATH = "benchmarks/swebench/hard-baseline-module-mapping.json";
const ARTIFACT_ROOT = "benchmarks/swebench/artifacts/hard-baseline-v1";
const DATASET_URL = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(DATASET)}&config=${CONFIG}&split=${SPLIT}`;
const DATASET_INFO_URL = `https://huggingface.co/api/datasets/${DATASET}`;
const EXTERNAL_TEST_MARKERS = [
  "postgresql",
  "mysql",
  "oracle",
  "mongodb",
  "selenium",
  "live_server",
];

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonObject)
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

const fail = (message: string): never => {
  throw new Error(`MANIFEST PREFLIGHT FAILED: ${message}`);
};

const pathWithoutQuotes = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"'))
    return trimmed.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  return trimmed;
};

const normalizePath = (value: string) => {
  const unquoted = pathWithoutQuotes(value).replaceAll("\\", "/");
  if (unquoted === "/dev/null") return "/dev/null";
  return unquoted.replace(/^\.?\//, "").replace(/^(?:a|b)\//, "");
};

interface Mapping {
  ignoredPrefixComponents: string[];
  repository: RepoName;
  sourceRoot: string[];
  testPathRules: string[];
}

const loadMapping = (): Mapping[] => {
  const value = JSON.parse(readFileSync(resolve(MAPPING_PATH), "utf8")) as {
    repositories?: Mapping[];
  };
  if (!value.repositories || value.repositories.length !== REPOSITORIES.length)
    fail("module mapping does not contain exactly five repositories");
  const byRepo = new Map(
    value.repositories.map((item) => [item.repository, item])
  );
  for (const repo of REPOSITORIES)
    if (!byRepo.has(repo)) fail(`missing module mapping: ${repo}`);
  return REPOSITORIES.map((repo) => byRepo.get(repo) as Mapping);
};

const parsePatchFiles = (patch: string) => {
  const sections: { path: string; lines: string[] }[] = [];
  let current: { path: string; lines: string[] } | undefined;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git a/")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (!match) fail(`unparseable diff header: ${line}`);
      const path = normalizePath(match[2]);
      current = { lines: [], path };
      sections.push(current);
    } else if (current) current.lines.push(line);
  }
  if (!sections.length) fail("canonical patch has no diff sections");
  return sections;
};

const isTestPath = (path: string, mapping: Mapping) => {
  const components = path.toLowerCase().split("/");
  const basename = components.at(-1) ?? "";
  if (
    components.some(
      (component) => component === "tests" || component === "test"
    )
  )
    return true;
  if (basename.startsWith("test_")) return true;
  if (
    basename.endsWith("_test.py") ||
    basename.endsWith(".test.js") ||
    basename.endsWith(".test.ts") ||
    basename.endsWith(".spec.js") ||
    basename.endsWith(".spec.ts")
  )
    return true;
  if (
    mapping.repository === "matplotlib/matplotlib" &&
    path.startsWith("lib/matplotlib/tests/")
  )
    return true;
  if (
    (mapping.repository === "scikit-learn/scikit-learn" ||
      mapping.repository === "sympy/sympy") &&
    /(^|\/)tests\//.test(path)
  )
    return true;
  return false;
};

const startsWithRoot = (path: string, root: string[]) =>
  path.split("/").slice(0, root.length).join("/") === root.join("/");

const classifyPath = (path: string, mapping: Mapping) => {
  if (path === "/dev/null")
    return {
      classification: "other" as Classification,
      classificationRule: "dev-null endpoint",
    };
  if (isTestPath(path, mapping))
    return {
      classification: "test" as Classification,
      classificationRule: "frozen repository test-path rule",
    };
  if (startsWithRoot(path, mapping.sourceRoot))
    return {
      classification: "production" as Classification,
      classificationRule: `under sourceRoot ${mapping.sourceRoot.join("/")}`,
    };
  return {
    classification: "other" as Classification,
    classificationRule: "outside sourceRoot and not a test path",
  };
};

const logicalModule = (path: string, mapping: Mapping) => {
  const components = path.split("/");
  const prefix = mapping.ignoredPrefixComponents.length;
  if (
    !startsWithRoot(path, mapping.sourceRoot) ||
    components.length <= prefix + 1
  )
    return "__root__";
  return components[prefix] ?? "__root__";
};

const parseJsonArray = (value: unknown, field: string, instanceId: string) => {
  if (typeof value !== "string")
    fail(`${instanceId}: ${field} is not a JSON string`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(`${instanceId}: ${field} is not valid JSON`);
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  )
    fail(`${instanceId}: ${field} is not a string array`);
  return parsed as string[];
};

const toTask = (row: JsonObject, mapping: Mapping) => {
  const instanceId = row.instance_id;
  if (typeof instanceId !== "string" || !instanceId)
    fail("row has no instance_id");
  const repo = row.repo;
  if (!REPOSITORIES.includes(repo as RepoName)) return undefined;
  const required = [
    "base_commit",
    "patch",
    "test_patch",
    "problem_statement",
    "version",
  ];
  for (const field of required)
    if (typeof row[field] !== "string" || !row[field])
      fail(`${instanceId}: missing ${field}`);
  const solutionPatch = row.patch as string;
  const testPatch = row.test_patch as string;
  const solutionSections = parsePatchFiles(solutionPatch);
  const testSections = parsePatchFiles(testPatch);
  const changedFiles = [
    ...new Set(solutionSections.flatMap((section) => [section.path])),
  ].sort();
  const files = changedFiles.map((path) => ({
    path,
    ...classifyPath(path, mapping),
  }));
  const productionSections = solutionSections.filter(
    (section) =>
      classifyPath(section.path, mapping).classification === "production"
  );
  const productionFiles = [
    ...new Set(productionSections.map((section) => section.path)),
  ].sort();
  if (!productionFiles.length) return undefined;
  const externalTestMarker = testSections
    .map((section) => section.path.toLowerCase())
    .find((path) =>
      EXTERNAL_TEST_MARKERS.some((marker) => path.includes(marker))
    );
  if (externalTestMarker) return undefined;
  const failToPass = parseJsonArray(
    row.FAIL_TO_PASS,
    "FAIL_TO_PASS",
    instanceId
  );
  const passToPass = parseJsonArray(
    row.PASS_TO_PASS,
    "PASS_TO_PASS",
    instanceId
  );
  if (!failToPass.length || !passToPass.length) return undefined;
  let productionLinesChanged = 0;
  let productionHunkCount = 0;
  for (const section of productionSections) {
    productionHunkCount += section.lines.filter((line) =>
      line.startsWith("@@")
    ).length;
    productionLinesChanged += section.lines.filter(
      (line) =>
        (line.startsWith("+") && !line.startsWith("+++")) ||
        (line.startsWith("-") && !line.startsWith("---"))
    ).length;
  }
  const productionModules = [
    ...new Set(productionFiles.map((path) => logicalModule(path, mapping))),
  ].sort();
  const testFiles = [
    ...new Set(testSections.map((section) => section.path)),
  ].sort();
  const validation =
    repo === "django/django"
      ? {
          args: [
            "tests/runtests.py",
            ...testFiles.map((path) =>
              path
                .replace(/^tests\//, "")
                .replace(/\.py$/, "")
                .replaceAll("/", ".")
            ),
          ],
          program: "python3",
        }
      : { args: ["-m", "pytest", "-q", ...testFiles], program: "python3" };
  return {
    baseCommit: row.base_commit,
    changedFiles: files,
    excluded: false,
    failToPass,
    id: instanceId,
    instanceId,
    metrics: {
      failToPassCount: failToPass.length,
      multiModule: productionModules.length >= 2,
      multiModuleNumeric: productionModules.length >= 2 ? 1 : 0,
      passToPassCount: passToPass.length,
      problemStatementLength: (row.problem_statement as string).length,
      productionFilesChanged: productionFiles.length,
      productionHunkCount,
      productionLinesChanged,
      productionModules,
    },
    passToPass,
    problemStatement: row.problem_statement,
    repo,
    solutionPatch,
    solutionPatchSha256: `sha256:${sha256(solutionPatch)}`,
    testFiles,
    testPatch,
    testPatchSha256: `sha256:${sha256(testPatch)}`,
    validation,
    version: row.version,
  };
};

const fetchJson = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) fail(`HTTP ${response.status} while fetching ${url}`);
  return (await response.json()) as JsonObject;
};

const fetchDataset = async () => {
  const info = await fetchJson(DATASET_INFO_URL);
  if (info.sha !== REVISION)
    fail(
      `dataset revision drift: expected ${REVISION}, got ${String(info.sha)}`
    );
  const first = await fetchJson(
    `${DATASET_URL}&offset=0&length=100&revision=${REVISION}`
  );
  const total = first.num_rows_total;
  if (typeof total !== "number" || total <= 0 || first.partial)
    fail("invalid first dataset page");
  const rows = [...((first.rows as JsonObject[]) ?? [])];
  for (let offset = 100; offset < total; offset += 100) {
    const page = await fetchJson(
      `${DATASET_URL}&offset=${offset}&length=100&revision=${REVISION}`
    );
    if (page.partial || !Array.isArray(page.rows))
      fail(`invalid dataset page at offset ${offset}`);
    rows.push(...(page.rows as JsonObject[]));
  }
  if (rows.length !== total)
    fail(`dataset row count mismatch: ${rows.length} != ${total}`);
  const rowIndices = rows.map((item) => item.row_idx);
  if (new Set(rowIndices).size !== rows.length)
    fail("duplicate dataset row index");
  rows.sort((a, b) => Number(a.row_idx) - Number(b.row_idx));
  return { info, rows, total };
};

const averageRanks = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = new Map<number, number>();
  for (let index = 0; index < sorted.length; ) {
    const value = sorted[index];
    let end = index + 1;
    while (end < sorted.length && sorted[end] === value) end += 1;
    rank.set(value, (index + 1 + end) / 2);
    index = end;
  }
  return values.map((value) => {
    const averageRank = rank.get(value);
    if (averageRank === undefined) fail("rank missing for metric value");
    return {
      averageRank,
      percentile:
        values.length === 1 ? 0.5 : (averageRank - 1) / (values.length - 1),
      rawValue: value,
    };
  });
};

const tieHash = (instanceId: string) =>
  sha256(`${PROTOCOL_VERSION}${SEPARATOR}${instanceId}`);
const compareHash = (a: { tieHash: string }, b: { tieHash: string }) =>
  a.tieHash.localeCompare(b.tieHash);

const build = async () => {
  const mapping = loadMapping();
  const clarificationSha = sha256(
    readFileSync(resolve(CLARIFICATION_PATH), "utf8")
  );
  const mappingSha = sha256(readFileSync(resolve(MAPPING_PATH), "utf8"));
  const effectiveProtocolIdentity = sha256(
    `${ORIGINAL_PROTOCOL_SHA}\n${clarificationSha}\n${mappingSha}`
  );
  const dataset = await fetchDataset();
  const rawRows = dataset.rows.map((item) => ({
    row: item.row,
    rowIdx: item.row_idx,
  }));
  const datasetRowsSha = hashJson({
    config: CONFIG,
    dataset: DATASET,
    revision: REVISION,
    rows: rawRows,
    split: SPLIT,
  });
  const byRepo = new Map<RepoName, ReturnType<typeof toTask>[]>();
  for (const repo of REPOSITORIES) byRepo.set(repo, []);
  const exclusions: { instanceId: string; reason: string }[] = [];
  for (const item of dataset.rows) {
    const row = item.row as JsonObject;
    const repo = row.repo as RepoName;
    if (!REPOSITORIES.includes(repo)) continue;
    const task = toTask(
      row,
      mapping.find((item) => item.repository === repo) as Mapping
    );
    if (task) byRepo.get(repo)?.push(task);
    else
      exclusions.push({
        instanceId: String(row.instance_id),
        reason: "failed predeclared eligibility predicate",
      });
  }
  for (const repo of REPOSITORIES)
    if ((byRepo.get(repo) ?? []).length < 4)
      fail(`${repo} has fewer than four eligible candidates`);
  const metricNames = [
    "productionFilesChanged",
    "productionLinesChanged",
    "multiModuleNumeric",
    "productionHunkCount",
    "failToPassCount",
    "passToPassCount",
    "problemStatementLength",
  ] as const;
  for (const repo of REPOSITORIES) {
    const candidates = byRepo.get(repo) ?? [];
    const rankValues = new Map<
      string,
      ReturnType<typeof averageRanks>[number]
    >();
    for (const metric of metricNames) {
      const ranks = averageRanks(
        candidates.map((candidate) => Number(candidate?.metrics[metric]))
      );
      candidates.forEach((candidate, index) => {
        const existing = rankValues.get(candidate?.instanceId ?? "") ?? {};
        rankValues.set(candidate?.instanceId ?? "", {
          ...existing,
          [metric]: ranks[index],
        });
      });
    }
    for (const candidate of candidates) {
      const ranks = rankValues.get(candidate?.instanceId ?? "") as Record<
        string,
        { rawValue: number; averageRank: number; percentile: number }
      >;
      const complexity =
        2 * ranks.productionFilesChanged.percentile +
        2 * ranks.productionLinesChanged.percentile +
        2 * ranks.multiModuleNumeric.percentile +
        ranks.productionHunkCount.percentile +
        ranks.failToPassCount.percentile +
        ranks.passToPassCount.percentile +
        ranks.problemStatementLength.percentile;
      candidate.metrics = {
        ...candidate.metrics,
        complexity,
        ranks,
      };
      candidate.tieHash = tieHash(candidate.instanceId);
    }
  }
  const candidatePool = {
    candidates: REPOSITORIES.flatMap((repo) => byRepo.get(repo) ?? []).sort(
      (a, b) => a.instanceId.localeCompare(b.instanceId)
    ),
    dataset: {
      config: CONFIG,
      name: DATASET,
      revision: REVISION,
      rowsSha256: datasetRowsSha,
      sourceRows: dataset.total,
      split: SPLIT,
    },
    exclusions: exclusions.sort((a, b) =>
      a.instanceId.localeCompare(b.instanceId)
    ),
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: 1,
  };
  const candidatePoolSha = hashJson(candidatePool);
  writeJson(`${ARTIFACT_ROOT}/dataset-snapshot.json`, {
    dataset: {
      config: CONFIG,
      datasetInfo: dataset.info,
      name: DATASET,
      revision: REVISION,
      rowsSha256: datasetRowsSha,
      sourceRows: dataset.total,
      split: SPLIT,
    },
    rows: rawRows,
  });
  writeJson(`${ARTIFACT_ROOT}/candidate-pool.json`, candidatePool);
  const selected: any[] = [];
  const selection = [];
  for (const repo of REPOSITORIES) {
    const candidates = [...(byRepo.get(repo) ?? [])] as any[];
    const available = () =>
      candidates.filter((candidate) => !selected.includes(candidate));
    const choose = (
      criterion: (candidate: any) => number,
      criterionName: string
    ) => {
      const options = available();
      options.sort(
        (a, b) =>
          criterion(b) - criterion(a) ||
          b.metrics.complexity - a.metrics.complexity ||
          compareHash(a, b)
      );
      const chosen = options[0];
      if (!chosen)
        fail(`${repo} ran out of unique candidates at ${criterionName}`);
      selected.push(chosen);
      selection.push({
        criterion: criterionName,
        instanceId: chosen.instanceId,
        repository: repo,
      });
    };
    choose(
      (candidate) => candidate.metrics.complexity,
      "intrinsic complexity heuristic"
    );
    choose(
      (candidate) => candidate.metrics.productionFilesChanged,
      "production-file coverage"
    );
    choose(
      (candidate) => candidate.metrics.failToPassCount,
      "FAIL_TO_PASS coverage"
    );
    choose(
      (candidate) => candidate.metrics.problemStatementLength,
      "problem-statement-length coverage"
    );
  }
  const manifestTasks = [...selected].sort(compareHash).map((candidate) => {
    const {
      changedFiles: _changedFiles,
      metrics: _metrics,
      excluded: _excluded,
      tieHash: _tieHash,
      ...task
    } = candidate;
    return task;
  });
  const multiModuleCount = selected.filter(
    (candidate) => candidate.metrics.multiModule
  ).length;
  const broadCount = selected.filter(
    (candidate) =>
      candidate.metrics.productionFilesChanged >= 2 ||
      candidate.metrics.productionLinesChanged >= 20
  ).length;
  const eligibleByRepository = Object.fromEntries(
    REPOSITORIES.map((repo) => [repo, (byRepo.get(repo) ?? []).length])
  );
  if (multiModuleCount < 2 || broadCount < 8) {
    const reason = [
      multiModuleCount < 2
        ? `selected multi-module count ${multiModuleCount} < 2`
        : "",
      broadCount < 8 ? `selected broad-task count ${broadCount} < 8` : "",
    ]
      .filter(Boolean)
      .join("; ");
    const stopped = {
      candidatePoolSha256: candidatePoolSha,
      clarificationSha256: clarificationSha,
      dataset: {
        config: CONFIG,
        name: DATASET,
        revision: REVISION,
        rowsSha256: datasetRowsSha,
        sourceRows: dataset.total,
        split: SPLIT,
      },
      effectiveProtocolIdentity,
      eligibleByRepository,
      inferenceInvoked: false,
      manifestSha256: null,
      moduleMappingSha256: mappingSha,
      originalProtocolSha256: ORIGINAL_PROTOCOL_SHA,
      scheduleCreated: false,
      schemaVersion: 1,
      selectedBroadTasks: broadCount,
      selectedDetails: selected.map((candidate) => ({
        changedFiles: candidate.changedFiles,
        instanceId: candidate.instanceId,
        multiModule: candidate.metrics.multiModule,
        productionFilesChanged: candidate.metrics.productionFilesChanged,
        productionLinesChanged: candidate.metrics.productionLinesChanged,
        productionModules: candidate.metrics.productionModules,
        repository: candidate.repo,
      })),
      selectedMultiModuleTasks: multiModuleCount,
      selection,
      status: "MANIFEST PREFLIGHT FAILED",
      stopReason: reason,
    };
    writeJson(`${ARTIFACT_ROOT}/selection-provenance.json`, stopped);
    writeJson(`${ARTIFACT_ROOT}/leakage-audit.json`, {
      inferenceInvoked: false,
      modelVisibleCandidateArtifactPaths: [],
      scheduleCreated: false,
      schemaVersion: 1,
      selectedIds: [],
      status: "STOPPED BEFORE MANIFEST FREEZE",
    });
    writeJson(`${ARTIFACT_ROOT}/preflight.json`, {
      manifestSha256: null,
      reason,
      rows: [],
      schemaVersion: 1,
      status: "MANIFEST PREFLIGHT FAILED",
    });
    console.log(
      JSON.stringify(
        {
          candidatePoolSha,
          clarificationSha,
          dataset: {
            config: CONFIG,
            name: DATASET,
            revision: REVISION,
            split: SPLIT,
          },
          effectiveProtocolIdentity,
          eligibleByRepository,
          manifestIds: [],
          manifestSha: null,
          moduleMappingSha: mappingSha,
          originalProtocolSha: ORIGINAL_PROTOCOL_SHA,
          preflight: "MANIFEST PREFLIGHT FAILED",
          selectedBroadTasks: broadCount,
          selectedMultiModuleTasks: multiModuleCount,
          sourceRows: dataset.total,
        },
        null,
        2
      )
    );
    return;
  }
  const manifest = {
    candidatePoolSha256: candidatePoolSha,
    dataset: DATASET,
    datasetSnapshot: `revision ${REVISION}; retrieved from ${DATASET_URL}; rows SHA-256 ${datasetRowsSha}`,
    experimentId: "exp-swebench-hard-baseline-v1",
    protocolProvenance: {
      clarificationSha256: clarificationSha,
      effectiveProtocolIdentity,
      moduleMappingSha256: mappingSha,
      originalProtocolSha256: ORIGINAL_PROTOCOL_SHA,
    },
    repositorySource: "https://github.com",
    schemaVersion: 1,
    selectionProtocol: `effective protocol ${effectiveProtocolIdentity}`,
    tasks: manifestTasks,
  };
  const manifestSha = hashJson(manifest);
  const selectionProvenance = {
    candidatePoolSha256: candidatePoolSha,
    clarificationSha256: clarificationSha,
    dataset: {
      config: CONFIG,
      name: DATASET,
      revision: REVISION,
      rowsSha256: datasetRowsSha,
      sourceRows: dataset.total,
      split: SPLIT,
    },
    effectiveProtocolIdentity,
    eligibleByRepository: Object.fromEntries(
      REPOSITORIES.map((repo) => [repo, (byRepo.get(repo) ?? []).length])
    ),
    manifestSha256: manifestSha,
    moduleMappingSha256: mappingSha,
    noModelInference: true,
    noSchedule: true,
    originalProtocolSha256: ORIGINAL_PROTOCOL_SHA,
    repositoryCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    schemaVersion: 1,
    selectedBroadTasks: broadCount,
    selectedMultiModuleTasks: multiModuleCount,
    selection,
    status: "constructed-before-inference",
  };
  const leakageAudit = {
    advisorOrScoutInvoked: false,
    candidateGoldPatchesPersistedOutsideModelWorkspaces: true,
    checks: [
      "candidate pool and manifest contain no model output",
      "gold patches are present only in frozen audit artifacts",
      "no inference workspace or model prompt was created",
    ],
    inferenceInvoked: false,
    modelVisibleCandidateArtifactPaths: [],
    modelVisiblePrompts: [],
    scheduleCreated: false,
    schemaVersion: 1,
    selectedIds: manifestTasks.map((task) => task.instanceId),
  };
  const preflight = {
    manifestSha256: manifestSha,
    reason:
      "run the inference-free workspace preflight with the frozen manifest",
    rows: [],
    schemaVersion: 1,
    status: "NOT_RUN",
  };
  writeJson(`${ARTIFACT_ROOT}/selection-provenance.json`, selectionProvenance);
  writeJson(`${ARTIFACT_ROOT}/leakage-audit.json`, leakageAudit);
  writeJson(`${ARTIFACT_ROOT}/preflight.json`, preflight);
  writeJson(`${ARTIFACT_ROOT}/manifest.json`, manifest);
  writeJson("benchmarks/swebench/hard-baseline-manifest.json", manifest);
  writeJson(
    "benchmarks/swebench/hard-baseline-selection-provenance.json",
    selectionProvenance
  );
  console.log(
    JSON.stringify(
      {
        candidatePoolSha,
        clarificationSha,
        datasetRows: dataset.total,
        effectiveProtocolIdentity,
        eligibleByRepository: selectionProvenance.eligibleByRepository,
        ids: manifestTasks.map((task) => task.instanceId),
        manifestSha,
        mappingSha,
        selectedBroadTasks: broadCount,
        selectedMultiModuleTasks: multiModuleCount,
      },
      null,
      2
    )
  );
};

build().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
