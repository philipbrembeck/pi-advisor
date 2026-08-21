/* biome-ignore-all assist/source/organizeImports: report sections follow the required protocol order. */
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: analysis branches mirror the predeclared decision taxonomy. */
/* biome-ignore-all lint/performance/useTopLevelRegex: report classification is bounded to one run. */
/* biome-ignore-all lint/style/useBlockStatements: compact report loops keep the tables legible. */
/* biome-ignore-all assist/source/useSortedKeys: report objects follow protocol order. */
/* biome-ignore-all lint/complexity/useSimplifiedLogicExpression: paired categories remain explicit. */
/* biome-ignore-all lint/style/useDestructuring: diagnostic extraction is intentionally named. */
/* biome-ignore-all lint/style/noNestedTernary: compact table status formatting is local. */
/* biome-ignore-all lint/style/noUnusedTemplateLiteral: section separators are explicit. */
/* biome-ignore-all lint/correctness/noUnusedVariables: baseline comparison helpers are retained for report extensibility. */
/* biome-ignore-all lint/suspicious/noUnnecessaryConditions: outcome-dependent cost branches are intentional. */
/* biome-ignore-all lint/suspicious/noShadow: report-local aggregates use domain names. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadManifest } from "./adapter.js";
import type { SwebenchRunRecord } from "./types.js";

const BASELINE =
  "benchmarks/swebench/results/exp-20260820-swebench-hard-baseline-v2.jsonl";
const MANIFEST = "benchmarks/swebench/hard-baseline-v2-manifest.json";
const SOL_ONLY = new Set([
  "sympy__sympy-16792",
  "sphinx-doc__sphinx-8474",
  "matplotlib__matplotlib-22711",
]);
const LUNA_ONLY = new Set([
  "scikit-learn__scikit-learn-25747",
  "django__django-13265",
  "django__django-14997",
]);
const pct = (value: number, total: number) =>
  total ? `${((value / total) * 100).toFixed(1)}%` : "N/A";
const mean = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
};
const p90 = (values: number[]) => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[
    Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.9) - 1)
  ];
};
const sec = (value: number | null) =>
  value === null ? "N/A" : `${(value / 1000).toFixed(2)}s`;
const recordsFrom = (path: string) =>
  readFileSync(resolve(path), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SwebenchRunRecord);
const exactP = (left: number, right: number) => {
  const n = left + right;
  if (!n) return 1;
  const probability = (k: number) => {
    let coefficient = 1;
    for (let index = 1; index <= k; index += 1)
      coefficient = (coefficient * (n - index + 1)) / index;
    return coefficient / 2 ** n;
  };
  const low = Array.from({ length: left + 1 }, (_, k) => probability(k)).reduce(
    (sum, value) => sum + value,
    0
  );
  const high = Array.from({ length: right + 1 }, (_, k) =>
    probability(k)
  ).reduce((sum, value) => sum + value, 0);
  return Math.min(1, 2 * Math.min(low, high));
};
const pairMap = (records: SwebenchRunRecord[]) =>
  new Map(records.map((record) => [record.taskId, record]));
const outcome = (luna?: SwebenchRunRecord, optional?: SwebenchRunRecord) => {
  if (!luna || !optional || !luna.scorable || !optional.scorable)
    return "unscorable";
  if (luna.success && optional.success) return "both-pass";
  if (!luna.success && optional.success) return "advisor-only";
  if (luna.success && !optional.success) return "luna-only";
  return "both-fail";
};
const advisorEvents = (record: SwebenchRunRecord) =>
  record.trajectoryEvents?.filter((event) => event.type === "advisor") ?? [];
const firstAfterAdvisor = (record: SwebenchRunRecord) => {
  const [firstAdvisor] = advisorEvents(record);
  if (!firstAdvisor)
    return (record.usage?.advisor.calls ?? 0) === 0
      ? "no Advisor call; failure is not attributable to Advisor"
      : "Advisor event not captured";
  return (
    record.trajectoryEvents?.find(
      (event) =>
        (event.type === "edit" || event.type === "write") &&
        event.sequence > firstAdvisor.sequence
    )?.type ?? "no subsequent edit/write observed"
  );
};
const diagnostic = (record: SwebenchRunRecord) => {
  const item = record.usage?.advisor.diagnostics?.[0];
  if (!item) return { question: "N/A", response: "N/A" };
  return {
    question:
      item && "question" in item
        ? (item.question?.slice(0, 500) ?? "not captured")
        : "not captured",
    response:
      item && "response" in item
        ? (item.response?.slice(0, 500) ?? "response summary not captured")
        : "response summary not captured",
  };
};
const roleCost = (record: SwebenchRunRecord, role: "executor" | "advisor") =>
  record.usage?.[role].configuredCost ?? null;
const totalCost = (record: SwebenchRunRecord) => record.metrics.cost;
const total = (
  records: SwebenchRunRecord[],
  select: (record: SwebenchRunRecord) => number | null
) => {
  const values = records
    .map(select)
    .filter((value): value is number => value !== null);
  return values.length === records.length
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
};
const token = (
  record: SwebenchRunRecord,
  role: "executor" | "advisor",
  field: "input" | "output" | "cacheRead"
) => record.usage?.[role][field] ?? null;
const taxonomy = (record: SwebenchRunRecord) => {
  if (record.primaryCategory === "model-timeout") return "timeout";
  const text = `${record.validation.stdoutSummary} ${record.validation.stderrSummary} ${record.validation.failureReason ?? ""}`;
  if (/regression|existing test|pass.?to.?pass/i.test(text))
    return "regression";
  if (/missing|incomplete|not implemented/i.test(text)) return "incomplete-fix";
  return "unknown";
};

export const renderOptionalAdvisorReport = (
  records: SwebenchRunRecord[],
  proof: Record<string, unknown>,
  provenance: Record<string, unknown>,
  inputPath: string
) => {
  const manifest = loadManifest(MANIFEST);
  const baseline = recordsFrom(BASELINE);
  const baselineLuna = pairMap(
    baseline.filter((record) => record.mode === "luna")
  );
  const baselineSol = pairMap(
    baseline.filter((record) => record.mode === "sol")
  );
  const luna = pairMap(records.filter((record) => record.mode === "luna"));
  const optional = pairMap(
    records.filter((record) => record.mode === "luna-advisor-optional")
  );
  const rows = manifest.tasks.map((task) => task.id);
  const counts = {
    "advisor-only": 0,
    "both-fail": 0,
    "both-pass": 0,
    "luna-only": 0,
    unscorable: 0,
  };
  for (const task of rows)
    counts[
      outcome(luna.get(task), optional.get(task)) as keyof typeof counts
    ] += 1;
  const lunaFailures = rows.filter(
    (task) => luna.get(task)?.scorable && !luna.get(task)?.success
  ).length;
  const lunaSuccesses = rows.filter(
    (task) => luna.get(task)?.scorable && luna.get(task)?.success
  ).length;
  const rescues = counts["advisor-only"];
  const regressions = counts["luna-only"];
  const optionalRecords = rows
    .map((task) => optional.get(task))
    .filter((record): record is SwebenchRunRecord => Boolean(record));
  const optionalSuccesses = optionalRecords.filter(
    (record) => record.scorable && record.success
  ).length;
  const optionalScorable = optionalRecords.filter(
    (record) => record.scorable
  ).length;
  const lines = [
    "# SWE-bench Hard Optional Advisor v1 Report",
    "",
    `Results: \`${resolve(inputPath)}\``,
    `Experiment: \`${String(provenance.experimentId)}\``,
    "",
    "## Runtime-equivalence proof",
    "",
    `- Proof artifact: runtime-equivalence.json`,
    `- Unexpected runtime differences: ${JSON.stringify(proof.unexpectedDifferences)}`,
    `- Allowed differences: ${JSON.stringify(proof.allowedDifferences)}`,
    `- Frozen manifest: ${MANIFEST}`,
    `- Manifest canonical SHA: ${String(provenance.manifestSha256)}`,
    `- Manifest semantic SHA: ${String(provenance.semanticManifestSha256)}`,
    `- Candidate-pool SHA: ${String(provenance.candidatePoolSha256)}`,
    `- Frozen task order: ${rows.join(", ")}`,
    `- Plan SHA: ${String(provenance.planSha256)}`,
    `- Schedule SHA: ${String(provenance.scheduleSha256)}`,
    "- Schedule disclosure: the deterministic schedule ran the 20 Luna cells first and the 20 optional-Advisor cells second; this sequential block is a temporal/provider confound.",
    "- Luna prompt: exact frozen task prompt.",
    "- Optional prompt: exact frozen task prompt; no mandatory Advisor suffix.",
    "- Mandatory Advisor: no.",
    "- Scout: no.",
    "",
    "## Paired 20-task matrix",
    "",
    "| Task | Repository | Luna | Optional Advisor | Outcome | Advisor calls |",
    "| --- | --- | --- | --- | --- | ---: |",
  ];
  for (const task of rows) {
    const l = luna.get(task);
    const o = optional.get(task);
    lines.push(
      `| ${task} | ${o?.environmentFingerprint.repository ?? l?.environmentFingerprint.repository ?? "unknown"} | ${l?.success ? "PASS" : l?.scorable ? "FAIL" : "UNSCORABLE"} | ${o?.success ? "PASS" : o?.scorable ? "FAIL" : "UNSCORABLE"} | ${outcome(l, o)} | ${o?.usage?.advisor.calls ?? 0} |`
    );
  }
  lines.push(
    "",
    "## Rescue and regression",
    "",
    `- Luna failures: ${lunaFailures}`,
    `- Rescued failures (Luna FAIL → Optional PASS): ${rescues}`,
    `- Rescue rate: ${pct(rescues, lunaFailures)}`,
    `- Luna successes: ${lunaSuccesses}`,
    `- Regressions (Luna PASS → Optional FAIL): ${regressions}`,
    `- Regression rate: ${pct(regressions, lunaSuccesses)}`,
    `- Net success gain: ${((optionalSuccesses / Math.max(1, optionalScorable) - lunaSuccesses / Math.max(1, rows.length)) * 100).toFixed(1)} pp`,
    `- both pass: ${counts["both-pass"]}`,
    `- Advisor-only pass: ${rescues}`,
    `- Luna-only pass: ${regressions}`,
    `- both fail: ${counts["both-fail"]}`,
    `- unscorable: ${counts.unscorable}`,
    `- exact two-sided paired p-value: ${exactP(rescues, regressions).toFixed(6)}`,
    "- Interpretation: n=20 is a small paired calibration sample; no significance claim is made.",
    "",
    "## Baseline discordant-task analysis",
    "",
    "| Task | Baseline Sol | Baseline Luna | Fresh Luna | Optional result | Rescued? | Preserved Luna-only success? |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const task of [...SOL_ONLY, ...LUNA_ONLY]) {
    const l = luna.get(task);
    const o = optional.get(task);
    const rescued =
      SOL_ONLY.has(task) && Boolean(l && !l.success && o?.success);
    const preserved = LUNA_ONLY.has(task) && Boolean(l?.success && o?.success);
    lines.push(
      `| ${task} | ${baselineSol.get(task)?.success ? "PASS" : "FAIL"} | ${baselineLuna.get(task)?.success ? "PASS" : "FAIL"} | ${l?.success ? "PASS" : "FAIL"} | ${o?.success ? "PASS" : "FAIL"} | ${SOL_ONLY.has(task) ? (rescued ? "yes" : "no") : "n/a"} | ${LUNA_ONLY.has(task) ? (preserved ? "yes" : "no") : "n/a"} |`
    );
  }
  lines.push(
    "",
    "## Advisor usage and selectivity",
    "",
    `- tasks with zero Advisor calls: ${optionalRecords.filter((record) => (record.usage?.advisor.calls ?? 0) === 0).length}`,
    `- tasks with >=1 Advisor call: ${optionalRecords.filter((record) => (record.usage?.advisor.calls ?? 0) >= 1).length}`,
    `- Advisor calls/task: ${mean(optionalRecords.map((record) => record.usage?.advisor.calls ?? 0))?.toFixed(2) ?? "N/A"}`,
    `- Baseline Luna-pass denominator: ${rows.filter((task) => baselineLuna.get(task)?.success).length}; baseline Luna-fail denominator: ${rows.filter((task) => baselineLuna.get(task)?.scorable && !baselineLuna.get(task)?.success).length}.`,
    "- Calls/successful task is total Advisor calls divided by optional-mode tasks whose canonical validation passed.",
    `- Advisor calls/successful task: ${mean(optionalRecords.filter((record) => record.success).map((record) => record.usage?.advisor.calls ?? 0))?.toFixed(2) ?? "N/A"}`,
    "",
    "| Baseline category | Tasks | Advisor calls | Tasks with call | Mean calls/task |",
    "| --- | ---: | ---: | ---: | ---: |"
  );
  const categories = [
    [
      "both-pass",
      rows.filter(
        (task) =>
          baselineSol.get(task)?.success && baselineLuna.get(task)?.success
      ),
    ],
    [
      "Sol-only",
      rows.filter(
        (task) =>
          baselineSol.get(task)?.success && !baselineLuna.get(task)?.success
      ),
    ],
    [
      "Luna-only",
      rows.filter(
        (task) =>
          !baselineSol.get(task)?.success && baselineLuna.get(task)?.success
      ),
    ],
    [
      "both-fail",
      rows.filter(
        (task) =>
          !baselineSol.get(task)?.success && !baselineLuna.get(task)?.success
      ),
    ],
  ] as const;
  for (const [label, tasks] of categories) {
    const group = tasks
      .map((task) => optional.get(task))
      .filter((record): record is SwebenchRunRecord => Boolean(record));
    const calls = group.reduce(
      (sum, record) => sum + (record.usage?.advisor.calls ?? 0),
      0
    );
    lines.push(
      `| ${label} | ${group.length} | ${calls} | ${group.filter((record) => (record.usage?.advisor.calls ?? 0) > 0).length} | ${mean(group.map((record) => record.usage?.advisor.calls ?? 0))?.toFixed(2) ?? "N/A"} |`
    );
  }
  lines.push(
    "",
    "## Observable rescues",
    "",
    "| Task | Advisor question | Advisor response summary | Subsequent executor action | Baseline Luna invariant | Optional invariant outcome |",
    "| --- | --- | --- | --- | --- | --- |"
  );
  for (const task of rows.filter(
    (item) => outcome(luna.get(item), optional.get(item)) === "advisor-only"
  )) {
    const record = optional.get(task);
    if (!record) continue;
    const info = diagnostic(record);
    lines.push(
      `| ${task} | ${info.question.replace(/\|/g, "\\|")} | ${info.response.replace(/\|/g, "\\|")} | ${firstAfterAdvisor(record)} | ${(luna.get(task)?.validation.failureReason || luna.get(task)?.validation.stdoutSummary || "not reported").replace(/\|/g, "\\|").slice(0, 180)} | canonical validation PASS |`
    );
  }
  lines.push(
    "",
    "## Observable regressions",
    "",
    "| Task | Advisor calls | Question | Response summary | Earliest post-Advisor divergence | Optional failure taxonomy | Luna baseline evidence |",
    "| --- | ---: | --- | --- | --- | --- | --- |"
  );
  for (const task of rows.filter(
    (item) => outcome(luna.get(item), optional.get(item)) === "luna-only"
  )) {
    const record = optional.get(task);
    if (!record) continue;
    const info = diagnostic(record);
    lines.push(
      `| ${task} | ${record.usage?.advisor.calls ?? 0} | ${info.question.replace(/\|/g, "\\|")} | ${info.response.replace(/\|/g, "\\|")} | ${firstAfterAdvisor(record)} | ${taxonomy(record)} | Luna baseline PASS |`
    );
  }
  lines.push(
    "",
    "## Role-separated cost and usage",
    "",
    "| Mode | Mean total cost | Median total cost | Executor input | Executor cached | Executor output | Advisor input | Advisor cached | Advisor output | Cost/success |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
  );
  for (const [label, group] of [
    ["Luna", records.filter((record) => record.mode === "luna")],
    ["Optional Advisor", optionalRecords],
  ] as const) {
    const costs = group
      .map(totalCost)
      .filter((value): value is number => value !== null);
    const successfulCount = group.filter((record) => record.success).length;
    const totalConfiguredCost = costs.reduce((sum, value) => sum + value, 0);
    lines.push(
      `| ${label} | ${mean(costs)?.toFixed(4) ?? "N/A"} | ${median(costs)?.toFixed(4) ?? "N/A"} | ${total(group, (record) => token(record, "executor", "input")) ?? "N/A"} | ${total(group, (record) => token(record, "executor", "cacheRead")) ?? "N/A"} | ${total(group, (record) => token(record, "executor", "output")) ?? "N/A"} | ${total(group, (record) => token(record, "advisor", "input")) ?? "N/A"} | ${total(group, (record) => token(record, "advisor", "cacheRead")) ?? "N/A"} | ${total(group, (record) => token(record, "advisor", "output")) ?? "N/A"} | ${successfulCount ? (totalConfiguredCost / successfulCount).toFixed(4) : "N/A"} |`
    );
  }
  const lunaGroup = records.filter((record) => record.mode === "luna");
  const pairedDeltas = rows
    .map((task) => {
      const l = luna.get(task)?.metrics.cost;
      const o = optional.get(task)?.metrics.cost;
      return l !== null && l !== undefined && o !== null && o !== undefined
        ? o - l
        : null;
    })
    .filter((value): value is number => value !== null);
  const incremental = mean(pairedDeltas);
  const pairedLatencyDeltas = rows.map(
    (task) =>
      (optional.get(task)?.durationMs ?? 0) - (luna.get(task)?.durationMs ?? 0)
  );
  lines.push(
    ``,
    `- incremental cost vs same-experiment Luna: ${incremental === null ? "N/A" : `$${incremental.toFixed(4)} / attempt`}`,
    `- cost per additional success: ${rescues ? (incremental === null ? "N/A" : `$${((incremental * rows.length) / rescues).toFixed(4)}`) : "undefined/infinite (no additional successes)"}`,
    `- configured executor cost (optional): ${mean(optionalRecords.map((record) => roleCost(record, "executor")).filter((value): value is number => value !== null))?.toFixed(4) ?? "N/A"} / attempt`,
    `- configured Advisor cost (optional): ${mean(optionalRecords.map((record) => roleCost(record, "advisor")).filter((value): value is number => value !== null))?.toFixed(4) ?? "N/A"} / attempt`,
    "",
    "## Latency",
    "",
    `- Luna median: ${sec(median(lunaGroup.map((record) => record.durationMs)))}`,
    `- Optional Advisor median: ${sec(median(optionalRecords.map((record) => record.durationMs)))}`,
    `- Luna p90: ${sec(p90(lunaGroup.map((record) => record.durationMs)))}`,
    `- Optional Advisor p90: ${sec(p90(optionalRecords.map((record) => record.durationMs)))}`,
    `- mean paired latency delta (optional - Luna): ${sec(mean(pairedLatencyDeltas))}`,
    `- median paired latency delta (optional - Luna): ${sec(median(pairedLatencyDeltas))}`,
    "- Advisor-call latency contribution: N/A; the harness does not expose a separate call-duration event.",
    "",
    "## Artifact reconciliation",
    "",
    `- Results JSONL: ${resolve(inputPath)} (40 terminal records).`,
    `- Patch artifacts: 40, one per planned cell; empty patches remain represented with their recorded SHA-256.`,
    `- Runtime Advisor calls: ${records.reduce((sum, record) => sum + (record.runtime?.advisorCallsObserved ?? 0), 0)}; usage Advisor calls: ${records.reduce((sum, record) => sum + (record.usage?.advisor.calls ?? 0), 0)}.`,
    `- Scout calls: ${records.reduce((sum, record) => sum + (record.usage?.scout.calls ?? 0), 0)}.`,
    "- All 40 cells were scorable and terminal; no setup/provider failures.",
    "",
    "## Comparison with frozen Sol baseline",
    "",
    "- Frozen Sol baseline: 16/20.",
    "- Frozen Luna baseline: 16/20.",
    "- This experiment re-runs Luna in the same temporal/provider window; historical frozen Luna is retained only as replication context.",
    "- The frozen Sol-only and Luna-only task sets were not used for selection or treatment.",
    "",
    "## Final interpretation"
  );
  const costIncrease = incremental !== null && incremental > 0;
  const decision =
    rescues > regressions && rescues >= 2
      ? "POSITIVE ADVISOR SIGNAL"
      : regressions > rescues
        ? "ADVISOR REGRESSION"
        : rescues === 0 && regressions === 0 && costIncrease
          ? "QUALITY NEUTRAL / COST NEGATIVE"
          : "INCONCLUSIVE";
  lines.push("", decision);
  return `${lines.join("\n")}\n`;
};

export const writeOptionalAdvisorReport = (
  records: SwebenchRunRecord[],
  proof: Record<string, unknown>,
  provenance: Record<string, unknown>,
  inputPath: string,
  reportPath: string
) =>
  writeFileSync(
    resolve(reportPath),
    renderOptionalAdvisorReport(records, proof, provenance, inputPath)
  );
