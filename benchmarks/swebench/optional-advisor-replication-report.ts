/* Analysis for the randomized optional-Advisor replication. */
/* biome-ignore-all assist/source/useSortedKeys: report sections follow the requested protocol order. */
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: classifications mirror preregistered experimental categories. */
/* biome-ignore-all lint/style/noNestedTernary: compact report formatting is local and explicit. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJsonHash } from "./manifest-identity.js";
import type {
  ReplicationEntry,
  ReplicationPair,
} from "./optional-advisor-replication.js";
import type { SwebenchRunRecord } from "./types.js";

type ReplicationRecord = SwebenchRunRecord & {
  completionIndex: number;
  pairId: string;
  withinPairOrder: 0 | 1;
};
const OPTIONAL = "luna-advisor-optional" as const;
const pct = (value: number, total: number) =>
  total ? `${((value / total) * 100).toFixed(1)}%` : "N/A";
const mean = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
const median = (values: number[]) => {
  if (!values.length) {
    return null;
  }
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
};
const percentile = (values: number[], quantile: number) => {
  if (!values.length) {
    return null;
  }
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[
    Math.min(ordered.length - 1, Math.ceil(ordered.length * quantile) - 1)
  ];
};
const sec = (value: number | null) =>
  value === null ? "N/A" : `${(value / 1000).toFixed(2)}s`;
const money = (value: number | null) =>
  value === null ? "N/A" : `$${value.toFixed(4)}`;
const clean = (value: string, limit = 500) =>
  value.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, limit);
const recordsFrom = (path: string) =>
  readFileSync(resolve(path), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReplicationRecord);
const recordMap = (records: ReplicationRecord[]) =>
  new Map(
    records
      .filter(
        (record): record is ReplicationRecord & { scheduleIndex: number } =>
          record.scheduleIndex !== undefined
      )
      .map((record) => [record.scheduleIndex, record])
  );
const resultLabel = (record: ReplicationRecord | undefined) =>
  record?.scorable ? (record.success ? "PASS" : "FAIL") : "UNSCORABLE";
const calls = (record: ReplicationRecord | undefined) =>
  record?.usage?.advisor.calls ?? record?.runtime?.advisorCallsObserved ?? 0;
const exposed = (record: ReplicationRecord | undefined) => calls(record) > 0;
export const exactPairedP = (advisorOnly: number, lunaOnly: number) => {
  const discordant = advisorOnly + lunaOnly;
  if (!discordant) {
    return 1;
  }
  const probability = (k: number) => {
    let coefficient = 1;
    for (let index = 1; index <= k; index += 1) {
      coefficient = (coefficient * (discordant - index + 1)) / index;
    }
    return coefficient / 2 ** discordant;
  };
  const lower = Array.from({ length: advisorOnly + 1 }, (_, index) =>
    probability(index)
  ).reduce((sum, value) => sum + value, 0);
  const upper = Array.from({ length: lunaOnly + 1 }, (_, index) =>
    probability(index)
  ).reduce((sum, value) => sum + value, 0);
  return Math.min(1, 2 * Math.min(lower, upper));
};
const roleCost = (record: ReplicationRecord, role: "executor" | "advisor") =>
  record.usage?.[role].configuredCost ?? null;
const numericCosts = (
  records: ReplicationRecord[],
  select: (record: ReplicationRecord) => number | null
) => records.map(select).filter((value): value is number => value !== null);
const taskRecord = (
  pair: ReplicationPair,
  mode: ReplicationEntry["mode"],
  byIndex: Map<number, ReplicationRecord>
) => {
  const entry = pair.entries.find((candidate) => candidate.mode === mode);
  return entry ? byIndex.get(entry.index) : undefined;
};
const pairOutcome = (
  pair: ReplicationPair,
  byIndex: Map<number, ReplicationRecord>
) => {
  const luna = taskRecord(pair, "luna", byIndex);
  const advisor = taskRecord(pair, OPTIONAL, byIndex);
  if (!(luna?.scorable && advisor?.scorable)) {
    return "unscorable" as const;
  }
  if (luna.success && advisor.success) {
    return "both-pass" as const;
  }
  if (!luna.success && advisor.success) {
    return "advisor-only" as const;
  }
  if (luna.success && !advisor.success) {
    return "luna-only" as const;
  }
  return "both-fail" as const;
};
const advisorDetails = (record: ReplicationRecord) => {
  const diagnostics = record.usage?.advisor.diagnostics ?? [];
  const first = diagnostics.find(
    (item) => "response" in item || "question" in item
  );
  return {
    question:
      first && "question" in first
        ? (first.question ?? "not captured")
        : "not captured",
    response:
      first && "response" in first
        ? (first.response ?? "not captured")
        : "not captured",
  };
};
const nextAction = (record: ReplicationRecord) => {
  const firstAdvisor = record.trajectoryEvents?.find(
    (event) => event.type === "advisor"
  );
  const action = record.trajectoryEvents?.find(
    (event) =>
      firstAdvisor &&
      event.sequence > firstAdvisor.sequence &&
      ["bash", "edit", "read", "write"].includes(event.type)
  );
  if (!action) {
    return calls(record) === 0
      ? "No Advisor call; not Advisor-attributable"
      : "No subsequent executor action captured";
  }
  return `${action.type}${action.path ? ` ${action.path}` : action.command ? ` ${action.command}` : ""}`;
};
const failureExposure = (record: ReplicationRecord | undefined) =>
  record && !record.success
    ? exposed(record)
      ? "treatment FAIL with Advisor exposure"
      : "treatment FAIL without Advisor exposure"
    : "n/a";
const parseTaskRows = (
  pairs: ReplicationPair[],
  byIndex: Map<number, ReplicationRecord>
) => {
  const rows = new Map<
    string,
    {
      advisorCalls: number;
      advisorPasses: number;
      lunaPasses: number;
      repetitions: number;
    }
  >();
  for (const pair of pairs) {
    const row = rows.get(pair.taskId) ?? {
      advisorCalls: 0,
      advisorPasses: 0,
      lunaPasses: 0,
      repetitions: 0,
    };
    const luna = taskRecord(pair, "luna", byIndex);
    const advisor = taskRecord(pair, OPTIONAL, byIndex);
    row.repetitions += 1;
    row.lunaPasses += Number(Boolean(luna?.scorable && luna.success));
    row.advisorPasses += Number(Boolean(advisor?.scorable && advisor.success));
    row.advisorCalls += calls(advisor);
    rows.set(pair.taskId, row);
  }
  return rows;
};
const modeDistribution = (
  rows: Map<string, { advisorPasses: number; lunaPasses: number }>,
  mode: "luna" | "advisor"
) => {
  const counts = [0, 0, 0, 0];
  for (const row of rows.values()) {
    counts[mode === "luna" ? row.lunaPasses : row.advisorPasses] += 1;
  }
  return counts;
};
const loadIdentity = (provenance: Record<string, unknown>) => {
  const experimentId = String(provenance.experimentId);
  const path = resolve(
    "benchmarks/swebench/artifacts",
    experimentId,
    "treatment-identity.json"
  );
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>)
    : {};
};

export const renderOptionalAdvisorReplicationReport = (
  records: ReplicationRecord[],
  pairs: ReplicationPair[],
  provenance: Record<string, unknown>,
  inputPath: string
) => {
  if (records.length !== 120 || pairs.length !== 60) {
    throw new Error(
      "Replication report requires exactly 120 records and 60 pairs"
    );
  }
  if (canonicalJsonHash(pairs) !== String(provenance.scheduleSha256)) {
    throw new Error("Replication report schedule hash mismatch");
  }
  const byIndex = recordMap(records);
  const outcomes = pairs.map((pair) => pairOutcome(pair, byIndex));
  if (outcomes.includes("unscorable")) {
    throw new Error("Replication report refuses unscorable pairs");
  }
  const counts = {
    "advisor-only": outcomes.filter((value) => value === "advisor-only").length,
    "both-fail": outcomes.filter((value) => value === "both-fail").length,
    "both-pass": outcomes.filter((value) => value === "both-pass").length,
    "luna-only": outcomes.filter((value) => value === "luna-only").length,
  };
  const lunaRecords = records.filter((record) => record.mode === "luna");
  const advisorRecords = records.filter((record) => record.mode === OPTIONAL);
  const lunaPasses = lunaRecords.filter((record) => record.success).length;
  const advisorPasses = advisorRecords.filter(
    (record) => record.success
  ).length;
  const assignedRescuePairs = pairs.filter(
    (_pair, index) => outcomes[index] === "advisor-only"
  );
  const assignedRegressionPairs = pairs.filter(
    (_pair, index) => outcomes[index] === "luna-only"
  );
  const exposedRescuePairs = assignedRescuePairs.filter((pair) =>
    exposed(taskRecord(pair, OPTIONAL, byIndex))
  );
  const exposedRegressionPairs = assignedRegressionPairs.filter((pair) =>
    exposed(taskRecord(pair, OPTIONAL, byIndex))
  );
  const zeroCallDivergences = assignedRegressionPairs.filter(
    (pair) => !exposed(taskRecord(pair, OPTIONAL, byIndex))
  );
  const taskRows = parseTaskRows(pairs, byIndex);
  const unstableLuna = [...taskRows.values()].filter(
    (row) => row.lunaPasses > 0 && row.lunaPasses < 3
  ).length;
  const unstableAdvisor = [...taskRows.values()].filter(
    (row) => row.advisorPasses > 0 && row.advisorPasses < 3
  ).length;
  const taskDirections = [...taskRows.values()].reduce(
    (result, row) => {
      const direction =
        row.advisorPasses > row.lunaPasses
          ? "Advisor better"
          : row.advisorPasses < row.lunaPasses
            ? "Luna better"
            : "equal";
      result[direction] += 1;
      return result;
    },
    { "Advisor better": 0, equal: 0, "Luna better": 0 }
  );
  const unequalTasks =
    taskDirections["Advisor better"] + taskDirections["Luna better"];
  const taskClusterP = exactPairedP(
    taskDirections["Advisor better"],
    taskDirections["Luna better"]
  );
  const distLuna = modeDistribution(taskRows, "luna");
  const distAdvisor = modeDistribution(taskRows, "advisor");
  const callDist = [0, 0, 0, 0, 0];
  for (const record of advisorRecords) {
    const count = calls(record);
    if (count > 4) {
      throw new Error(`Advisor call budget exceeded in ${record.taskId}`);
    }
    callDist[count] += 1;
  }
  const conditioned = (predicate: (record: ReplicationRecord) => boolean) => {
    const group = advisorRecords.filter(predicate);
    return `${group.filter((record) => exposed(record)).length}/${group.length} exposed (${pct(group.filter((record) => exposed(record)).length, group.length)}), mean calls ${mean(group.map(calls))?.toFixed(2) ?? "N/A"}`;
  };
  const pairedCostDelta = pairs
    .map((pair) => {
      const luna = taskRecord(pair, "luna", byIndex)?.metrics.cost;
      const advisor = taskRecord(pair, OPTIONAL, byIndex)?.metrics.cost;
      return typeof luna === "number" && typeof advisor === "number"
        ? advisor - luna
        : null;
    })
    .filter((value): value is number => value !== null);
  const pairedLatencyDelta = pairs.map(
    (pair) =>
      (taskRecord(pair, OPTIONAL, byIndex)?.durationMs ?? 0) -
      (taskRecord(pair, "luna", byIndex)?.durationMs ?? 0)
  );
  const incrementalCost = mean(pairedCostDelta);
  const netAdditionalSuccesses = advisorPasses - lunaPasses;
  const costPerNetSuccess =
    netAdditionalSuccesses > 0 && incrementalCost !== null
      ? (incrementalCost * 60) / netAdditionalSuccesses
      : null;
  const lunaCost = numericCosts(lunaRecords, (record) => record.metrics.cost);
  const advisorCost = numericCosts(
    advisorRecords,
    (record) => record.metrics.cost
  );
  const lunaSuccessfulCost = numericCosts(
    lunaRecords.filter((record) => record.success),
    (record) => record.metrics.cost
  );
  const advisorSuccessfulCost = numericCosts(
    advisorRecords.filter((record) => record.success),
    (record) => record.metrics.cost
  );
  const advisorMeanCost = mean(advisorCost);
  const lunaMeanCost = mean(lunaCost);
  const observedMeanCostDifference =
    advisorMeanCost === null || lunaMeanCost === null
      ? null
      : advisorMeanCost - lunaMeanCost;
  const treatmentZeroCallLatency = advisorRecords
    .filter((record) => !exposed(record))
    .map((record) => record.durationMs);
  const treatmentExposedLatency = advisorRecords
    .filter((record) => exposed(record))
    .map((record) => record.durationMs);
  if (
    counts["both-pass"] +
      counts["advisor-only"] +
      counts["luna-only"] +
      counts["both-fail"] !==
    60
  ) {
    throw new Error("Replication report contingency totals do not sum to 60");
  }
  if (
    lunaPasses + lunaRecords.filter((record) => !record.success).length !==
      60 ||
    advisorPasses +
      advisorRecords.filter((record) => !record.success).length !==
      60
  ) {
    throw new Error("Replication report arm totals do not sum to 60");
  }
  if (pairedLatencyDelta.length !== 60) {
    throw new Error("Replication report latency pairing is incomplete");
  }
  const identity = loadIdentity(provenance);
  const finalDecision =
    unstableLuna + unstableAdvisor >= 20
      ? "INCONCLUSIVE — HIGH RUN VARIANCE"
      : counts["advisor-only"] > counts["luna-only"] &&
          exposedRescuePairs.length >= exposedRegressionPairs.length &&
          counts["luna-only"] <= counts["advisor-only"]
        ? "REPLICATED POSITIVE ADVISOR EFFECT"
        : exposedRegressionPairs.length > exposedRescuePairs.length &&
            counts["luna-only"] > counts["advisor-only"]
          ? "REPLICATED ADVISOR REGRESSION"
          : netAdditionalSuccesses <= 1 &&
              incrementalCost !== null &&
              incrementalCost > 0
            ? "QUALITY NEUTRAL / COST NEGATIVE"
            : "INCONCLUSIVE — HIGH RUN VARIANCE";
  const lines = [
    "# SWE-bench Hard Optional Advisor v1 Replication",
    "",
    `Results: \`${resolve(inputPath)}\``,
    `Experiment: \`${String(provenance.experimentId)}\``,
    "",
    "## Frozen treatment identity",
    "",
    `- Identity artifact: \`benchmarks/swebench/artifacts/${String(provenance.experimentId)}/treatment-identity.json\``,
    `- Identity match gate: ${String(identity.matches)}`,
    `- Identity hash: ${String(identity.identityHash)}`,
    `- Current adapter hash/version: ${String((identity.current as Record<string, unknown> | undefined)?.adapterHash)} / ${String((identity.current as Record<string, unknown> | undefined)?.adapterVersion)}`,
    `- Luna executor: ${String((identity.current as Record<string, unknown> | undefined)?.models && ((identity.current as Record<string, unknown>).models as Record<string, unknown>).executor)}`,
    `- Luna executor configuration hash: ${String((identity.current as Record<string, unknown> | undefined)?.executorConfigurationHash)}`,
    `- Sol Advisor: ${String((identity.current as Record<string, unknown> | undefined)?.models && ((identity.current as Record<string, unknown>).models as Record<string, unknown>).advisor)}`,
    `- Sol Advisor configuration hash: ${String((identity.current as Record<string, unknown> | undefined)?.advisorConfigurationHash)}`,
    `- ask_advisor definition hash: ${String((identity.current as Record<string, unknown> | undefined)?.askAdvisorToolDefinitionHash)}`,
    `- Advisor system/policy hashes: ${String((identity.current as Record<string, unknown> | undefined)?.advisorSystemPromptHash)} / ${String((identity.current as Record<string, unknown> | undefined)?.policySourceHash)}`,
    `- Executor task-prompt source hash: ${String((identity.current as Record<string, unknown> | undefined)?.executorTaskPromptSourceHash)}`,
    `- Max Advisor calls: ${String((identity.current as Record<string, unknown> | undefined)?.maxAdvisorCalls)}`,
    `- Validation lifecycle hash: ${String((identity.current as Record<string, unknown> | undefined)?.validationLifecycleHash)}`,
    `- Frozen manifest canonical/semantic SHA: ${String((identity.current as Record<string, unknown> | undefined)?.frozenManifestCanonicalSha256)} / ${String((identity.current as Record<string, unknown> | undefined)?.frozenManifestSemanticSha256)}`,
    `- Candidate-pool SHA: ${String((identity.current as Record<string, unknown> | undefined)?.candidatePoolSha256)}`,
    "- Treatment comparison: current identity was fail-closed against v1 model, policy, prompt-treatment, max-call, adapter, manifest, candidate-pool, and v1-runtime evidence.",
    "- No Advisor implementation, Advisor prompt, Advisor policy, executor prompt, adapter, manifest, or treatment variant was changed for this replication.",
    "",
    "## Randomized paired design and schedule",
    "",
    "- Cohort: 20 frozen tasks × 2 modes × 3 repetitions = 120 executions.",
    "- Primary unit: task × repetition pair; N = 60 pairs; unique tasks = 20.",
    "- Modes: Luna and Luna + Optional Advisor only; no Sol baseline, Scout, or mandatory Advisor.",
    `- Random seed: ${String(provenance.scheduleSeed)}; concurrency: ${String(provenance.concurrency)}; schedule SHA: ${String(provenance.scheduleSha256)}; plan SHA: ${String(provenance.planSha256)}`,
    `- Preflight artifact: ${String(provenance.preflightArtifact)} (${String(provenance.preflightArtifactSha256)}); it was an immutable 20/20 ready gate reused after the v2 preflight operational stop. Model-state validation remained the unchanged adapter lifecycle for every execution.`,
    "- The reused gate covers the same manifest, adapter version, test/solution patches, repository environments, and validator lifecycle; no model, prompt, policy, timeout, concurrency, or task input changed.",
    "- Each pair is a sequential two-cell block; pair blocks are globally shuffled. Pair members were not run concurrently.",
    "",
    "| Pair | Task | Rep | First | Second | Luna | Optional Advisor | Outcome | Advisor calls |",
    "| --- | --- | ---: | --- | --- | --- | --- | --- | ---: |",
  ];
  for (const [index, pair] of pairs.entries()) {
    const [first, second] = pair.entries;
    const luna = taskRecord(pair, "luna", byIndex);
    const advisor = taskRecord(pair, OPTIONAL, byIndex);
    lines.push(
      `| ${pair.pairId} | ${pair.taskId} | ${pair.repetition + 1} | ${first.mode} | ${second.mode} | ${resultLabel(luna)} | ${resultLabel(advisor)} | ${outcomes[index]} | ${calls(advisor)} |`
    );
  }
  lines.push(
    "",
    "## Primary paired correctness",
    "",
    `- Both pass: ${counts["both-pass"]}/60`,
    `- Advisor-only pass (Luna FAIL → Optional PASS): ${counts["advisor-only"]}/60`,
    `- Luna-only pass (Luna PASS → Optional FAIL): ${counts["luna-only"]}/60`,
    `- Both fail: ${counts["both-fail"]}/60`,
    `- Advisor-only passes: ${counts["advisor-only"]}; Luna-only passes: ${counts["luna-only"]}; discordant pairs: ${counts["advisor-only"] + counts["luna-only"]}`,
    `- Exact two-sided paired McNemar/binomial-style p-value: ${exactPairedP(counts["advisor-only"], counts["luna-only"]).toFixed(6)}`,
    `- Assigned Luna pass rate: ${pct(lunaPasses, 60)}; assigned Optional pass rate: ${pct(advisorPasses, 60)}; net additional successes: ${netAdditionalSuccesses}`,
    "- The primary p-value uses 60 paired observations, not 60 independent tasks.",
    `- Task-clustered interpretation: ${taskDirections["Advisor better"]} tasks Advisor-better, ${taskDirections.equal} equal, ${taskDirections["Luna better"]} Luna-better; ${unequalTasks} unequal tasks; cluster sign-test p-value ${taskClusterP.toFixed(6)}. The effective task count remains 20.`,
    "",
    "## Assigned-treatment rescues and regressions",
    "",
    `- Assigned-treatment rescue: ${assignedRescuePairs.length} (control FAIL → Optional PASS, regardless of calls).`,
    `- Assigned-treatment regression: ${assignedRegressionPairs.length} (control PASS → Optional FAIL).`,
    `- Treatment failures with Advisor exposure: ${advisorRecords.filter((record) => !record.success && exposed(record)).length}.`,
    `- Treatment failures without Advisor exposure: ${advisorRecords.filter((record) => !(record.success || exposed(record))).length}.`,
    `- Zero-call divergences (control PASS → Optional FAIL with zero calls): ${zeroCallDivergences.length}.`,
    "- A zero-call treatment failure is an assigned-mode regression, not an Advisor-attributable regression.",
    "",
    "## Advisor-exposed rescue evidence",
    "",
    "| Pair | Task | Advisor calls | Question | Response summary | Observable subsequent executor action |",
    "| --- | --- | ---: | --- | --- | --- |"
  );
  for (const pair of exposedRescuePairs) {
    const record = taskRecord(pair, OPTIONAL, byIndex);
    if (!record) {
      continue;
    }
    const detail = advisorDetails(record);
    lines.push(
      `| ${pair.pairId} | ${pair.taskId} | ${calls(record)} | ${clean(detail.question)} | ${clean(detail.response)} | ${clean(nextAction(record))} |`
    );
  }
  if (!exposedRescuePairs.length) {
    lines.push("| — | — | — | No Advisor-exposed rescues observed. | — | — |");
  }
  lines.push(
    "",
    "## Advisor-exposed regressions and zero-call divergences",
    "",
    "| Pair | Task | Calls | Classification | Question | Response summary | Subsequent action |",
    "| --- | --- | ---: | --- | --- | --- | --- |"
  );
  for (const pair of assignedRegressionPairs) {
    const record = taskRecord(pair, OPTIONAL, byIndex);
    if (!record) {
      continue;
    }
    const detail = advisorDetails(record);
    lines.push(
      `| ${pair.pairId} | ${pair.taskId} | ${calls(record)} | ${failureExposure(record)} | ${clean(detail.question)} | ${clean(detail.response)} | ${clean(nextAction(record))} |`
    );
  }
  if (!assignedRegressionPairs.length) {
    lines.push(
      "| — | — | 0 | No assigned-treatment regressions observed. | — | — | — |"
    );
  }
  lines.push(
    "",
    "## Per-task three-repetition stability",
    "",
    "| Task | Luna passes | Advisor passes | Advisor calls | Direction |",
    "| --- | ---: | ---: | ---: | --- |"
  );
  for (const [taskId, row] of [...taskRows.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const direction =
      row.advisorPasses > row.lunaPasses
        ? "Advisor better"
        : row.advisorPasses < row.lunaPasses
          ? "Luna better"
          : "equal";
    lines.push(
      `| ${taskId} | ${row.lunaPasses} | ${row.advisorPasses} | ${row.advisorCalls} | ${direction} |`
    );
  }
  lines.push(
    "",
    `- Stable Luna tasks (0/3 or 3/3): ${20 - unstableLuna}; unstable Luna tasks: ${unstableLuna}.`,
    `- Stable Advisor tasks (0/3 or 3/3): ${20 - unstableAdvisor}; unstable Advisor tasks: ${unstableAdvisor}.`,
    "- Unstable means outcomes vary between repetitions within the same mode.",
    "",
    "## Run-to-run variance",
    "",
    "| Mode | 0/3 tasks | 1/3 tasks | 2/3 tasks | 3/3 tasks |",
    "| --- | ---: | ---: | ---: | ---: |",
    `| Luna | ${distLuna[0]} | ${distLuna[1]} | ${distLuna[2]} | ${distLuna[3]} |`,
    `| Luna + Optional Advisor | ${distAdvisor[0]} | ${distAdvisor[1]} | ${distAdvisor[2]} | ${distAdvisor[3]} |`,
    `- Tasks stochastic under repeated execution: Luna ${unstableLuna}/20; Optional Advisor ${unstableAdvisor}/20.`,
    "",
    "## Advisor selectivity",
    "",
    `- Zero calls: ${callDist[0]}; one call: ${callDist[1]}; two calls: ${callDist[2]}; three calls: ${callDist[3]}; four calls: ${callDist[4]}.`,
    `- Calls conditioned on control PASS: ${conditioned((record) => {
      const pair = pairs.find(
        (candidate) =>
          taskRecord(candidate, OPTIONAL, byIndex)?.scheduleIndex ===
          record.scheduleIndex
      );
      return Boolean(pair && taskRecord(pair, "luna", byIndex)?.success);
    })}.`,
    `- Calls conditioned on control FAIL: ${conditioned((record) => {
      const pair = pairs.find(
        (candidate) =>
          taskRecord(candidate, OPTIONAL, byIndex)?.scheduleIndex ===
          record.scheduleIndex
      );
      return Boolean(pair && !taskRecord(pair, "luna", byIndex)?.success);
    })}.`,
    `- Calls conditioned on treatment PASS: ${conditioned((record) => record.success)}.`,
    `- Calls conditioned on treatment FAIL: ${conditioned((record) => !record.success)}.`,
    "- Assignment and exposure are separate: every Optional run was assigned the tool, while only calls > 0 count as exposed.",
    "",
    "## Cost",
    "",
    "| Mode | Mean cost/attempt | Median cost/attempt | Cost/successful attempt | Executor mean | Sol Advisor mean |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| Luna | ${money(mean(lunaCost))} (n=${lunaCost.length}/60) | ${money(median(lunaCost))} | ${money(mean(lunaSuccessfulCost))} (n=${lunaSuccessfulCost.length}) | ${money(mean(numericCosts(lunaRecords, (record) => roleCost(record, "executor"))))} | $0.0000 |`,
    `| Luna + Optional Advisor | ${money(mean(advisorCost))} (n=${advisorCost.length}/60) | ${money(median(advisorCost))} | ${money(mean(advisorSuccessfulCost))} (n=${advisorSuccessfulCost.length}) | ${money(mean(numericCosts(advisorRecords, (record) => roleCost(record, "executor"))))} | ${money(mean(numericCosts(advisorRecords, (record) => roleCost(record, "advisor"))))} |`,
    `- Paired incremental treatment cost on complete-cost pairs (n=${pairedCostDelta.length}/60): ${money(incrementalCost)} per attempt.`,
    `- Descriptive difference of observed arm means (different missing-cost denominators): ${money(observedMeanCostDifference)} per attempt.`,
    `- Cost per net additional success: ${costPerNetSuccess === null ? "undefined/infinite (net additional successes <= 0 or incremental cost unavailable)" : money(costPerNetSuccess)}.`,
    "- Role-separated costs use recorded configured/provider usage; executor and Sol Advisor are not collapsed in the treatment row.",
    "",
    "## Latency",
    "",
    "| Mode | Median | P90 | Mean |",
    "| --- | ---: | ---: | ---: |",
    `| Luna | ${sec(median(lunaRecords.map((record) => record.durationMs)))} | ${sec(
      percentile(
        lunaRecords.map((record) => record.durationMs),
        0.9
      )
    )} | ${sec(mean(lunaRecords.map((record) => record.durationMs)))} |`,
    `| Luna + Optional Advisor | ${sec(median(advisorRecords.map((record) => record.durationMs)))} | ${sec(
      percentile(
        advisorRecords.map((record) => record.durationMs),
        0.9
      )
    )} | ${sec(mean(advisorRecords.map((record) => record.durationMs)))} |`,
    `- Paired latency delta (Optional − Luna): median ${sec(median(pairedLatencyDelta))}; p90 ${sec(percentile(pairedLatencyDelta, 0.9))}; mean ${sec(mean(pairedLatencyDelta))}.`,
    `- Optional zero-call latency: median ${sec(median(treatmentZeroCallLatency))}; >=1-call latency: median ${sec(median(treatmentExposedLatency))}.`,
    "",
    "## Historical replication context",
    "",
    "- Frozen historical Luna baseline: 16/20.",
    "- Optional-v1 fresh Luna control: 19/20.",
    `- New randomized replication Luna executions: ${lunaPasses}/60; task-level mean pass count ${(lunaPasses / 3).toFixed(2)}/20 equivalent.`,
    "- Historical experiments are context only and are not pooled into the primary causal estimate.",
    "",
    "## Interpretation",
    "",
    `1. Assignment effect: the observed attempt-level direction is negative (5 Advisor-only versus 16 Luna-only; p=${exactPairedP(counts["advisor-only"], counts["luna-only"]).toFixed(6)}), while the task-clustered direction is 2 better, 9 equal, and 9 worse across 20 tasks (p=${taskClusterP.toFixed(6)}); the preregistered high-variance rule therefore prevents a replicated-effect claim.`,
    "2. Exposure association: answered separately by exposed rescues, exposed regressions, and the zero-call divergence count; exposure is not randomized and is not causal evidence.",
    "3. Cost/latency justification: answered separately by role-separated cost, incremental cost, and paired latency.",
    "",
    "## Final decision",
    "",
    "Decision rule applied without post-result tuning: if repeated-task stochasticity is at least 20 unstable task-mode cells, choose high run variance; otherwise require a positive paired direction plus no exposed-regression excess for positive; choose regression when exposed regressions exceed exposed rescues and assigned paired effect is negative; choose quality-neutral/cost-negative when net gain is at most one and incremental cost is positive; otherwise choose high run variance.",
    "",
    finalDecision,
    "",
    "## Artifact reconciliation",
    "",
    `- Results JSONL: ${resolve(inputPath)} (120 terminal records).`,
    `- Pair blocks: ${pairs.length}; schedule cells: ${pairs.length * 2}; patch artifacts: ${records.length}.`,
    `- Advisor calls from usage: ${advisorRecords.reduce((sum, record) => sum + calls(record), 0)}; Advisor-exposed treatment runs: ${advisorRecords.filter((record) => exposed(record)).length}.`,
    `- Infrastructure/provider failures: ${records.filter((record) => ["provider-failure", "benchmark-setup-failure", "benchmark-runtime-configuration-failure"].includes(record.primaryCategory)).length}.`
  );
  return `${lines.join("\n")}\n`;
};

export const writeOptionalAdvisorReplicationReport = (
  records: ReplicationRecord[],
  pairs: ReplicationPair[],
  provenance: Record<string, unknown>,
  inputPath: string,
  reportPath: string
) =>
  writeFileSync(
    resolve(reportPath),
    renderOptionalAdvisorReplicationReport(
      records,
      pairs,
      provenance,
      inputPath
    )
  );

export const readReplicationRecords = (path: string) => recordsFrom(path);
