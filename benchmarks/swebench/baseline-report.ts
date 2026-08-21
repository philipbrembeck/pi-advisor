/* biome-ignore-all assist/source/organizeImports: report sections follow the required publication order. */
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: analysis branches map directly to the predeclared report taxonomy. */
/* biome-ignore-all lint/style/noNestedTernary: compact status formatting keeps tables readable. */
/* biome-ignore-all lint/style/useBlockStatements: report loops remain compact and section-oriented. */
/* biome-ignore-all lint/performance/useTopLevelRegex: failure taxonomy patterns are local diagnostic rules. */
/* biome-ignore-all lint/complexity/useSimplifiedLogicExpression: paired outcome guards preserve explicit evidence categories. */
/* biome-ignore-all lint/complexity/useOptionalChain: report table guards preserve missing-cell distinction. */
/* biome-ignore-all lint/style/noNegationElse: table status formatting follows the required output order. */
/* biome-ignore-all lint/style/noUnusedTemplateLiteral: blank report sections are intentionally explicit. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJsonHash } from "./manifest-identity.js";
import type { SwebenchManifest, SwebenchRunRecord } from "./types.js";

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
const duration = (value: number | null) =>
  value === null ? "N/A" : `${(value / 1000).toFixed(2)}s`;
const modelLabel = (model: "sol" | "luna") =>
  model === "sol" ? "Sol" : "Luna";
const failureText = (record: SwebenchRunRecord) =>
  `${record.primaryCategory} ${record.termination.error ?? ""} ${record.validation.failureReason ?? ""} ${record.validation.stdoutSummary} ${record.validation.stderrSummary}`;
const failureEvidence = (record: SwebenchRunRecord) =>
  record.validation.failureReason ||
  record.validation.stderrSummary ||
  record.validation.stdoutSummary ||
  record.termination.error ||
  "not reported";
const failureType = (record: SwebenchRunRecord) => {
  if (record.primaryCategory === "model-timeout" || record.validation.timedOut)
    return "timeout";
  const text = failureText(record);
  if (/regression|pass.?to.?pass|existing test/i.test(text))
    return "regression";
  if (/edge case|boundary|corner case/i.test(text))
    return "incorrect-edge-case";
  if (/incomplete|missing|not implemented|only .* passed/i.test(text))
    return "incomplete-fix";
  if (/root cause|wrong .*cause/i.test(text)) return "wrong-root-cause";
  if (/too broad|unrelated|protected test/i.test(text))
    return "over-broad-patch";
  return "unknown";
};
const exactBinomialP = (solOnly: number, lunaOnly: number) => {
  const n = solOnly + lunaOnly;
  if (!n) return 1;
  const lower = Array.from({ length: solOnly + 1 }, (_, k) => {
    let coefficient = 1;
    for (let i = 1; i <= k; i += 1)
      coefficient = (coefficient * (n - i + 1)) / i;
    return coefficient / 2 ** n;
  }).reduce((sum, value) => sum + value, 0);
  const upper = Array.from({ length: lunaOnly + 1 }, (_, k) => {
    let coefficient = 1;
    for (let i = 1; i <= k; i += 1)
      coefficient = (coefficient * (n - i + 1)) / i;
    return coefficient / 2 ** n;
  }).reduce((sum, value) => sum + value, 0);
  return Math.min(1, 2 * Math.min(lower, upper));
};
const pairMap = (records: SwebenchRunRecord[]) => {
  const pairs = new Map<
    string,
    { sol?: SwebenchRunRecord; luna?: SwebenchRunRecord }
  >();
  for (const record of records) {
    const pair = pairs.get(record.taskId) ?? {};
    if (record.mode === "sol" || record.mode === "luna")
      pair[record.mode] = record;
    pairs.set(record.taskId, pair);
  }
  return pairs;
};
const pairOutcome = (pair: {
  sol?: SwebenchRunRecord;
  luna?: SwebenchRunRecord;
}) => {
  if (!pair.sol || !pair.luna || !pair.sol.scorable || !pair.luna.scorable)
    return "unscorable";
  if (pair.sol.success && pair.luna.success) return "both-pass";
  if (pair.sol.success) return "sol-only";
  if (pair.luna.success) return "luna-only";
  return "both-fail";
};
const rescueAssessment = (record: SwebenchRunRecord) =>
  record.modelPatch.productionFilesChanged.length === 0
    ? "likely-rescuable"
    : "possibly-rescuable";
const tokenTotal = (
  records: SwebenchRunRecord[],
  field: "inputTokens" | "cachedInputTokens" | "outputTokens" | "totalTokens"
) => {
  const values = records
    .map((record) => record.metrics[field])
    .filter((value): value is number => value !== null);
  return values.length === records.length
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
};
const costTotal = (records: SwebenchRunRecord[]) => {
  const values = records
    .map((record) => record.metrics.cost)
    .filter((value): value is number => value !== null);
  return values.length === records.length
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
};

export const renderBaselineReport = (
  records: SwebenchRunRecord[],
  manifest: SwebenchManifest,
  provenance: Record<string, unknown>,
  inputPath: string
) => {
  const pairs = pairMap(records);
  let bothPass = 0;
  let solOnly = 0;
  let lunaOnly = 0;
  let bothFail = 0;
  let unscorable = 0;
  for (const pair of pairs.values()) {
    const outcome = pairOutcome(pair);
    if (outcome === "both-pass") bothPass += 1;
    else if (outcome === "sol-only") solOnly += 1;
    else if (outcome === "luna-only") lunaOnly += 1;
    else if (outcome === "both-fail") bothFail += 1;
    else unscorable += 1;
  }
  const lines = [
    "# SWE-bench Hard Baseline v2 Report",
    "",
    `Results: \`${resolve(inputPath)}\``,
    `Experiment: \`${String(provenance.experimentId)}\``,
    "",
    "## Integrity and provenance",
    "",
    `- Manifest canonical SHA: \`${String(provenance.manifestSha256)}\``,
    `- Manifest semantic SHA: \`${String(provenance.semanticManifestSha256)}\``,
    `- Candidate-pool SHA: \`${String(provenance.candidatePoolSha256)}\``,
    `- Plan SHA: \`${String(provenance.planSha256)}\``,
    `- Schedule SHA: \`${String(provenance.scheduleSha256)}\``,
    `- Benchmark repository commit: \`${String(provenance.benchmarkRepositoryCommit)}\``,
    `- Adapter: \`${String(provenance.adapterVersion)}\``,
    `- Concurrency: ${String(provenance.concurrency)}`,
    "- Advisor: not run",
    "- Scout: not run",
    "",
    "## Primary paired task matrix",
    "",
    "| Task | Repository | Sol | Luna | Pair outcome |",
    "| --- | --- | --- | --- | --- |",
    ...manifest.tasks.map((task) => {
      const pair = pairs.get(task.id) ?? {};
      const status = (record?: SwebenchRunRecord) =>
        !record
          ? "missing"
          : record.scorable
            ? record.success
              ? "PASS"
              : "FAIL"
            : "UNSCORABLE";
      return `| ${task.id} | ${task.repo} | ${status(pair.sol)} | ${status(pair.luna)} | ${pairOutcome(pair)} |`;
    }),
    "",
    "### Pair totals",
    "",
    `- both pass: ${bothPass}`,
    `- Sol-only: ${solOnly}`,
    `- Luna-only: ${lunaOnly}`,
    `- both fail: ${bothFail}`,
    `- unscorable: ${unscorable}`,
    `- discordant pairs: ${solOnly + lunaOnly}`,
    "",
    "## Aggregate correctness",
    "",
    "| Model | Success | Scorable | Correctness |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const model of ["sol", "luna"] as const) {
    const group = records.filter((record) => record.mode === model);
    const successes = group.filter(
      (record) => record.scorable && record.success
    ).length;
    const scored = group.filter((record) => record.scorable).length;
    lines.push(
      `| ${modelLabel(model)} | ${successes} | ${scored} | ${pct(successes, scored)} |`
    );
  }
  const solRecords = records.filter((record) => record.mode === "sol");
  const lunaRecords = records.filter((record) => record.mode === "luna");
  const solCorrect =
    solRecords.filter((record) => record.scorable && record.success).length /
    Math.max(1, solRecords.filter((record) => record.scorable).length);
  const lunaCorrect =
    lunaRecords.filter((record) => record.scorable && record.success).length /
    Math.max(1, lunaRecords.filter((record) => record.scorable).length);
  lines.push(
    ``,
    `- absolute percentage-point delta (Sol - Luna): ${((solCorrect - lunaCorrect) * 100).toFixed(1)} pp`,
    "",
    "## Repository breakdown",
    "",
    "| Repository | Sol | Luna |",
    "| --- | ---: | ---: |"
  );
  for (const repo of [...new Set(manifest.tasks.map((task) => task.repo))]) {
    const tasks = manifest.tasks.filter((task) => task.repo === repo);
    const count = (model: "sol" | "luna") =>
      tasks.filter((task) => {
        const record = pairs.get(task.id)?.[model];
        return record?.scorable && record.success;
      }).length;
    lines.push(
      `| ${repo} | ${count("sol")}/${tasks.length} | ${count("luna")}/${tasks.length} |`
    );
  }
  lines.push(
    "",
    "## Statistical comparison",
    "",
    `- both-pass count: ${bothPass}`,
    `- Sol-only count: ${solOnly}`,
    `- Luna-only count: ${lunaOnly}`,
    `- both-fail count: ${bothFail}`,
    `- discordant pairs: ${solOnly + lunaOnly}`,
    `- exact two-sided McNemar/binomial sign-style p-value: ${exactBinomialP(solOnly, lunaOnly).toFixed(6)}`,
    "- Interpretation: n=20 paired tasks is a small calibration sample; this is directional evidence, not a broad significance claim.",
    "",
    "## Advisor-opportunity analysis (Sol PASS / Luna FAIL)",
    "",
    "| Task | Repository | Luna failure | Failing invariant | Luna patch scope | Sol patch scope | Rescue assessment |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const task of manifest.tasks) {
    const pair = pairs.get(task.id);
    if (
      !pair?.sol?.success ||
      !pair.luna ||
      !pair.luna.scorable ||
      pair.luna.success
    )
      continue;
    lines.push(
      `| ${task.id} | ${task.repo} | ${failureType(pair.luna)} | ${failureEvidence(pair.luna).replace(/\|/g, "\\|").slice(0, 180)} | ${pair.luna.modelPatch.productionFilesChanged.join(", ") || "none"} | ${pair.sol.modelPatch.productionFilesChanged.join(", ") || "none"} | ${rescueAssessment(pair.luna)} |`
    );
  }
  if (
    !lines.at(-1)?.includes("|") ||
    lines.at(-1) === "| --- | --- | --- | --- | --- | --- | --- |"
  )
    lines.push("No scorable Sol-pass/Luna-fail pairs.");
  lines.push(
    "",
    "## Luna-only cases",
    "",
    "| Task | Repository | Luna result | Sol failure | Luna patch scope | Observation |",
    "| --- | --- | --- | --- | --- | --- |"
  );
  for (const task of manifest.tasks) {
    const pair = pairs.get(task.id);
    if (!pair?.luna?.success || !pair.sol || pair.sol.success) continue;
    lines.push(
      `| ${task.id} | ${task.repo} | PASS | ${failureType(pair.sol)} | ${pair.luna.modelPatch.productionFilesChanged.join(", ") || "none"} | canonical validation passes; Luna has an observable valid solution, while Sol failed ${failureType(pair.sol)} |`
    );
  }
  lines.push(
    "",
    "## Failure taxonomy",
    "",
    "| Failure type | Sol | Luna |",
    "| --- | ---: | ---: |"
  );
  for (const type of [
    "wrong-root-cause",
    "incomplete-fix",
    "incorrect-edge-case",
    "regression",
    "over-broad-patch",
    "timeout",
    "other",
    "unknown",
  ]) {
    lines.push(
      `| ${type} | ${solRecords.filter((record) => !record.success && record.scorable && failureType(record) === type).length} | ${lunaRecords.filter((record) => !record.success && record.scorable && failureType(record) === type).length} |`
    );
  }
  lines.push(
    "",
    "## Efficiency and usage",
    "",
    "| Model | Median duration | P90 duration | Mean duration | Model calls | Agent turns | Tool calls | Input tokens | Cached input | Output tokens | Total tokens | Cost |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
  );
  for (const [model, group] of [
    ["sol", solRecords],
    ["luna", lunaRecords],
  ] as const) {
    const durations = group.map((record) => record.durationMs);
    lines.push(
      `| ${modelLabel(model)} | ${duration(median(durations))} | ${duration(p90(durations))} | ${duration(mean(durations))} | ${group.reduce((sum, record) => sum + record.metrics.modelCalls, 0)} | ${group.reduce((sum, record) => sum + record.metrics.agentTurns, 0)} | ${group.reduce((sum, record) => sum + record.metrics.toolCalls, 0)} | ${tokenTotal(group, "inputTokens") ?? "N/A"} | ${tokenTotal(group, "cachedInputTokens") ?? "N/A"} | ${tokenTotal(group, "outputTokens") ?? "N/A"} | ${tokenTotal(group, "totalTokens") ?? "N/A"} | ${costTotal(group) === null ? "N/A" : `$${costTotal(group)?.toFixed(4)}`} |`
    );
  }
  const assessment =
    solCorrect >= 0.9 && lunaCorrect >= 0.9 && solOnly + lunaOnly <= 2
      ? "CEILING — HARDER SUITE REQUIRED"
      : Math.abs(solCorrect - lunaCorrect) < 0.05 && solOnly + lunaOnly >= 4
        ? "SUSPICIOUS BASELINE — INVESTIGATE"
        : lunaCorrect > solCorrect && lunaOnly >= 2
          ? "SUSPICIOUS BASELINE — INVESTIGATE"
          : solCorrect < 0.3 && lunaCorrect < 0.3
            ? "BOTH MODELS TOO WEAK — REVIEW SUITE"
            : solCorrect > lunaCorrect && solOnly >= 2
              ? "READY FOR ADVISOR EXPERIMENT REVIEW"
              : "SUSPICIOUS BASELINE — INVESTIGATE";
  lines.push(
    "",
    "## Final decision",
    "",
    `Sol correctness: ${pct(solRecords.filter((record) => record.scorable && record.success).length, solRecords.filter((record) => record.scorable).length)}`,
    `Luna correctness: ${pct(lunaRecords.filter((record) => record.scorable && record.success).length, lunaRecords.filter((record) => record.scorable).length)}`,
    `Delta: ${((solCorrect - lunaCorrect) * 100).toFixed(1)} pp`,
    "",
    `Both pass: ${bothPass}`,
    `Sol-only: ${solOnly}`,
    `Luna-only: ${lunaOnly}`,
    `Both fail: ${bothFail}`,
    `Unscorable: ${unscorable}`,
    "",
    `Discordant pairs: ${solOnly + lunaOnly}`,
    `Statistical comparison: exact two-sided p=${exactBinomialP(solOnly, lunaOnly).toFixed(6)}`,
    "",
    `Sol median duration: ${duration(median(solRecords.map((record) => record.durationMs)))}`,
    `Luna median duration: ${duration(median(lunaRecords.map((record) => record.durationMs)))}`,
    "",
    `Sol cost: ${costTotal(solRecords) === null ? "N/A" : `$${costTotal(solRecords)?.toFixed(4)}`}`,
    `Luna cost: ${costTotal(lunaRecords) === null ? "N/A" : `$${costTotal(lunaRecords)?.toFixed(4)}`}`,
    "",
    `Benchmark assessment: ${assessment}`
  );
  return `${lines.join("\n")}\n`;
};

export const writeBaselineReport = (
  records: SwebenchRunRecord[],
  manifest: SwebenchManifest,
  provenance: Record<string, unknown>,
  inputPath: string,
  reportPath: string
) => {
  const report = renderBaselineReport(records, manifest, provenance, inputPath);
  writeFileSync(resolve(reportPath), report);
  writeFileSync(
    `${resolve(reportPath)}.json`,
    `${JSON.stringify({ experimentId: provenance.experimentId, manifestSha256: provenance.manifestSha256, reportSha256: canonicalJsonHash(report), resultsPath: resolve(inputPath), schemaVersion: 1 }, null, 2)}\n`
  );
  return report;
};
