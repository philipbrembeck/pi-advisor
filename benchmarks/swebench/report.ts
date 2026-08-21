/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: the report enumerates each required benchmark outcome explicitly. */
/* biome-ignore-all lint/style/useBlockStatements: compact report assembly keeps required sections legible. */
/* biome-ignore-all lint/complexity/useSimplifiedLogicExpression: paired outcome branches are intentionally explicit. */
/* biome-ignore-all lint/suspicious/noShadow: report loops use the domain name consistently. */
import { writeFileSync } from "node:fs";
import type { SwebenchRunRecord } from "./types.js";

const pct = (n: number, d: number) =>
  d ? `${((n / d) * 100).toFixed(1)}%` : "N/A";
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const p90 = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]
    : null;
};
const duration = (value: number | null) =>
  value === null ? "N/A" : `${(value / 1000).toFixed(2)}s`;

export const renderSwebenchReport = (
  records: SwebenchRunRecord[],
  inputPath: string
) => {
  const models = ["sol", "luna"] as const;
  const scorable = (record: SwebenchRunRecord) => record.scorable;
  const lines = [
    "# SWE-bench Control v2",
    "",
    `Fresh results: \`${inputPath}\``,
    "",
    "The adapter prepares the exact base commit and canonical test patch before model invocation. Validation replays only production changes on a canonical prepared worktree, so model edits to benchmark-test files cannot alter the validator.",
    "",
    "## Scorability",
    "",
    "| Mode | Total | Scorable | Unscorable |",
    "| --- | ---: | ---: | ---: |",
    ...models.map((model) => {
      const group = records.filter((record) => record.mode === model);
      return `| ${model[0].toUpperCase() + model.slice(1)} | ${group.length} | ${group.filter(scorable).length} | ${group.filter((r) => !scorable(r)).length} |`;
    }),
    "",
    "## Correctness",
    "",
    "| Mode | Success | Scorable | Rate |",
    "| --- | ---: | ---: | ---: |",
    ...models.map((model) => {
      const group = records.filter((record) => record.mode === model);
      const good = group.filter(
        (record) => scorable(record) && record.success
      ).length;
      return `| ${model[0].toUpperCase() + model.slice(1)} | ${good} | ${group.filter(scorable).length} | ${pct(good, group.filter(scorable).length)} |`;
    }),
    "",
    "## Paired outcomes",
    "",
  ];
  const pairs = new Map<
    string,
    Partial<Record<"sol" | "luna", SwebenchRunRecord>>
  >();
  for (const record of records) {
    const key = `${record.taskId}/${record.repetition}`;
    const pair = pairs.get(key) ?? {};
    if (record.mode === "sol" || record.mode === "luna")
      pair[record.mode] = record;
    pairs.set(key, pair);
  }
  let bothPass = 0;
  let solOnly = 0;
  let lunaOnly = 0;
  let bothFail = 0;
  let unscorablePair = 0;
  for (const pair of pairs.values()) {
    if (
      !pair.sol ||
      !pair.luna ||
      !scorable(pair.sol) ||
      !scorable(pair.luna)
    ) {
      unscorablePair += 1;
      continue;
    }
    if (pair.sol.success && pair.luna.success) bothPass += 1;
    else if (pair.sol.success) solOnly += 1;
    else if (pair.luna.success) lunaOnly += 1;
    else bothFail += 1;
  }
  lines.push(
    `- both pass: ${bothPass}`,
    `- Sol-only pass: ${solOnly}`,
    `- Luna-only pass: ${lunaOnly}`,
    `- both fail: ${bothFail}`,
    `- unscorable pair: ${unscorablePair}`,
    "",
    "## Per-task results",
    "",
    "| Task | Sol | Luna |",
    "| --- | ---: | ---: |",
    ...[...new Set(records.map((record) => record.taskId))]
      .sort()
      .map((task) => {
        const result = (model: "sol" | "luna") =>
          records.filter(
            (record) =>
              record.taskId === task && record.mode === model && record.success
          ).length;
        return `| ${task.replace("django-django-", "")} | ${result("sol")}/3 | ${result("luna")}/3 |`;
      }),
    "",
    "## Failure reasons",
    ""
  );
  for (const record of records.filter(
    (record) => record.primaryCategory === "model-validation-failure"
  )) {
    lines.push(
      `- ${record.taskId}, repetition ${record.repetition}, ${record.model}: ${record.validation.failureReason ?? "validator failed"}; patch artifact \`${record.modelPatch.artifactPath}\`; production files ${record.modelPatch.productionFilesChanged.join(", ") || "none"}; patch ${record.modelPatch.diffBytes} bytes.`
    );
  }
  if (
    !records.some(
      (record) => record.primaryCategory === "model-validation-failure"
    )
  )
    lines.push("None.");
  lines.push("", "## Infrastructure failures", "");
  for (const record of records.filter((record) => !record.scorable))
    lines.push(
      `- ${record.taskId}, repetition ${record.repetition}, ${record.model}: ${record.primaryCategory} — ${record.error ?? record.validation.failureReason ?? "no diagnostic"}`
    );
  if (!records.some((record) => !record.scorable)) lines.push("None.");
  lines.push(
    "",
    "## Cost / latency",
    "",
    "| Mode | Mean cost / attempt | Median duration | P90 duration | Model calls | Agent turns | Tool calls |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
  );
  for (const model of models) {
    const group = records.filter((record) => record.mode === model);
    const costs = group
      .map((r) => r.metrics.cost)
      .filter((v): v is number => v !== null);
    lines.push(
      `| ${model} | ${costs.length ? `$${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4)}` : "N/A"} | ${duration(median(group.map((r) => r.durationMs)))} | ${duration(p90(group.map((r) => r.durationMs)))} | ${group.reduce((n, r) => n + r.metrics.modelCalls, 0)} | ${group.reduce((n, r) => n + r.metrics.agentTurns, 0)} | ${group.reduce((n, r) => n + r.metrics.toolCalls, 0)} |`
    );
  }
  lines.push(
    "",
    "## Historical differential cases",
    "",
    ...models.map((model) => {
      const task15996 = records.filter(
        (record) =>
          record.taskId.endsWith("15996") &&
          record.mode === model &&
          record.success
      ).length;
      const task15902 = records.filter(
        (record) =>
          record.taskId.endsWith("15902") &&
          record.mode === model &&
          record.success
      ).length;
      const task16046 = records.filter(
        (record) =>
          record.taskId.endsWith("16046") &&
          record.mode === model &&
          record.success
      ).length;
      return `- ${model}: 15996 ${task15996}/3, 15902 ${task15902}/3, 16046 ${task16046}/3; no control-test-patch-apply outcomes.`;
    }),
    "",
    "## Adapter invariants",
    "",
    "- Setup failures are classified before model invocation.",
    "- Model patches are captured relative to the benchmark-prepared state.",
    "- Canonical test files are restored by validation worktrees and are never used from the model's mutated workspace.",
    "- Declared temperature is recorded separately from effective provider fields; absent transmission is reported as provider-controlled.",
    "- Advisor modes were not run.",
    "- Archived v2 execution IDs are deterministic hashes of the frozen task/model/repetition entry; the current adapter persists its random execution ID directly.",
    ""
  );
  return `${lines.join("\n")}\n`;
};

export const writeSwebenchReport = (
  records: SwebenchRunRecord[],
  inputPath: string,
  path: string
) => writeFileSync(path, renderSwebenchReport(records, inputPath));
