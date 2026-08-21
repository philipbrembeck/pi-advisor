/* biome-ignore-all lint/style/noNonNullAssertion: report tables are built only after guarded mode/category aggregation. */
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: report construction keeps every paired outcome and failure category explicit. */
/* biome-ignore-all lint/style/useDestructuring: mode-keyed records are intentionally explicit in paired diagnostics. */
/* biome-ignore-all lint/style/useBlockStatements: paired outcome counters are intentionally compact. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { aggregate, isSuccessful } from "./statistics.js";
import type {
  AggregateMetrics,
  BenchmarkCategory,
  BenchmarkReport,
  RawBenchmarkResult,
} from "./types.js";
import {
  ALL_MODES,
  BENCHMARK_SCHEMA_VERSION,
  type BenchmarkMode,
  CATEGORIES,
} from "./types.js";

export const readResults = (path: string): RawBenchmarkResult[] =>
  readFileSync(resolve(path), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      const value = JSON.parse(line) as RawBenchmarkResult;
      if (value.schemaVersion !== BENCHMARK_SCHEMA_VERSION) {
        throw new Error(
          `Unsupported result schema on line ${index + 1}: ${value.schemaVersion}`
        );
      }
      return value;
    });

const pairKey = (record: RawBenchmarkResult) =>
  JSON.stringify([
    record.taskId,
    record.repetition,
    record.experimentHash ?? record.provenance.benchmarkConfigHash,
    record.provenance.fixtureHash,
    record.provenance.taskHash,
  ]);
const pairs = (records: RawBenchmarkResult[]) => {
  const result = new Map<
    string,
    Partial<Record<BenchmarkMode, RawBenchmarkResult>>
  >();
  for (const record of records) {
    const current = result.get(pairKey(record)) ?? {};
    current[record.mode] = record;
    result.set(pairKey(record), current);
  }
  return result;
};
const pct = (value: number | null) =>
  value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
const money = (value: number | null) =>
  value === null ? "N/A" : `$${value.toFixed(4)}`;
const duration = (value: number | null) =>
  value === null ? "N/A" : `${(value / 1000).toFixed(2)}s`;
const delta = (left: number, right: number, count: number) =>
  count ? left - right : null;

export const buildReport = (
  records: RawBenchmarkResult[],
  inputPath: string,
  seed = 1,
  runs = 1
): BenchmarkReport => {
  const byMode = Object.fromEntries(
    ALL_MODES.map((mode) => [
      mode,
      aggregate(records.filter((record) => record.mode === mode)),
    ])
  ) as Record<BenchmarkMode, AggregateMetrics>;
  const frontier = byMode.baseline.medianDurationMs;
  for (const mode of ALL_MODES) {
    byMode[mode].speedIndex =
      frontier && byMode[mode].medianDurationMs
        ? byMode[mode].medianDurationMs / frontier
        : null;
  }
  const byCategory = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      Object.fromEntries(
        ALL_MODES.map((mode) => [
          mode,
          aggregate(
            records.filter(
              (record) => record.category === category && record.mode === mode
            )
          ),
        ])
      ),
    ])
  ) as Partial<
    Record<BenchmarkCategory, Record<BenchmarkMode, AggregateMetrics>>
  >;

  const grouped = pairs(records);
  const preferredRecords = (preferred: BenchmarkMode, alias: BenchmarkMode) =>
    records.some((record) => record.mode === preferred)
      ? records.filter((record) => record.mode === preferred)
      : records.filter((record) => record.mode === alias);
  const comparisonSmall = preferredRecords("small-baseline", "luna");
  const comparisonAdvisor = preferredRecords(
    "advisor",
    "luna-advisor-mandatory"
  );
  const comparisonFrontier = preferredRecords("baseline", "sol");
  const comparisonScout = preferredRecords(
    "advisor-scout",
    "luna-advisor-scout"
  );
  let allModesPass = 0;
  let solOnly = 0;
  let lunaOnly = 0;
  let advisorRescue = 0;
  let advisorRegression = 0;
  let smallFailures = 0;
  let advisorPairs = 0;
  let allModePairs = 0;
  let allModeMissing = 0;
  let scoutAdvisorFail = 0;
  let scoutAdvisorPass = 0;
  let unchangedPass = 0;
  let unchangedFail = 0;
  let scoutComparable = 0;
  let scoutMissing = 0;
  const pairedDiagnostics: BenchmarkReport["pairedDiagnostics"] = [];

  for (const group of grouped.values()) {
    const small = group["small-baseline"] ?? group.luna;
    const advisor = group.advisor ?? group["luna-advisor-mandatory"];
    const frontierRecord = group.baseline ?? group.sol;
    const scout = group["advisor-scout"] ?? group["luna-advisor-scout"];
    if (small && advisor) {
      advisorPairs += 1;
      const smallPassed = isSuccessful(small);
      const advisorPassed = isSuccessful(advisor);
      if (!smallPassed) {
        smallFailures += 1;
      }
      if (!smallPassed && advisorPassed) {
        advisorRescue += 1;
      }
      if (smallPassed && !advisorPassed) {
        advisorRegression += 1;
      }
      if (smallPassed !== advisorPassed) {
        pairedDiagnostics.push({
          advisor: advisorPassed,
          repetitions: 1,
          smallBaseline: smallPassed,
          taskId: small.taskId,
        });
      }
    }
    if (frontierRecord && small && advisor && scout) {
      allModePairs += 1;
      const outcomes = [
        isSuccessful(frontierRecord),
        isSuccessful(small),
        isSuccessful(advisor),
        isSuccessful(scout),
      ];
      if (outcomes.every(Boolean)) {
        allModesPass += 1;
      }
      if (frontierRecord.correct && outcomes.slice(1).every((pass) => !pass)) {
        solOnly += 1;
      }
      if (
        !frontierRecord.correct &&
        small.correct &&
        !advisor.correct &&
        !scout.correct
      ) {
        lunaOnly += 1;
      }
    } else {
      allModeMissing += 1;
    }
    if (advisor && scout) {
      scoutComparable += 1;
      const advisorPassed = isSuccessful(advisor);
      const scoutPassed = isSuccessful(scout);
      if (!advisorPassed && scoutPassed) {
        scoutAdvisorFail += 1;
      }
      if (advisorPassed && !scoutPassed) {
        scoutAdvisorPass += 1;
      }
      if (advisorPassed && scoutPassed) {
        unchangedPass += 1;
      }
      if (!(advisorPassed || scoutPassed)) {
        unchangedFail += 1;
      }
    } else {
      scoutMissing += 1;
    }
  }

  const advisorRecords = comparisonAdvisor;
  const scoutRecords = comparisonScout;
  const advisorAggregate = aggregate(comparisonAdvisor);
  const scoutAggregate = aggregate(comparisonScout);
  const smallAggregate = aggregate(comparisonSmall);
  const advisorCost = advisorAggregate.meanCost;
  const smallCost = smallAggregate.meanCost;
  const warnings = [
    records.length === 0 ? "No runs are available." : "",
    ...ALL_MODES.filter(
      (mode) => byMode[mode].attempts > 0 && byMode[mode].attempts < 2
    ).map(
      (mode) =>
        `${mode} has insufficient repeated-run samples for confidence intervals.`
    ),
    ...ALL_MODES.filter(
      (mode) =>
        byMode[mode].attempts > 0 &&
        byMode[mode].costCoverage < byMode[mode].attempts
    ).map(
      (mode) =>
        `${mode} cost coverage is ${byMode[mode].costCoverage}/${byMode[mode].attempts}; missing usage was not treated as zero.`
    ),
    runs < 2
      ? "Paired rescue/regression rates are smoke diagnostics with fewer than two repetitions."
      : "",
  ].filter(Boolean);

  const advisorInput = advisorRecords
    .map((record) => record.advisor.input)
    .filter((value): value is number => value !== null);
  const scoutAdvisorInput = scoutRecords
    .map((record) => record.advisor.input)
    .filter((value): value is number => value !== null);
  const advisorInputMean = advisorInput.length
    ? advisorInput.reduce((sum, value) => sum + value, 0) / advisorInput.length
    : null;
  const scoutAdvisorInputMean = scoutAdvisorInput.length
    ? scoutAdvisorInput.reduce((sum, value) => sum + value, 0) /
      scoutAdvisorInput.length
    : null;

  return {
    byCategory,
    comparisons: {
      advisorCallsPerAttempt: advisorRecords.length
        ? advisorRecords.reduce(
            (sum, record) => sum + record.advisor.calls,
            0
          ) / advisorRecords.length
        : null,
      advisorTaskUsePercent: advisorRecords.length
        ? advisorRecords.filter((record) => record.advisor.calls > 0).length /
          advisorRecords.length
        : null,
      correctnessDelta: delta(
        advisorAggregate.correctness,
        smallAggregate.correctness,
        advisorPairs
      ),
      costReduction:
        advisorCost !== null && smallCost ? 1 - advisorCost / smallCost : null,
      frontierQualityRetained: aggregate(comparisonFrontier).correctness
        ? advisorAggregate.correctness /
          aggregate(comparisonFrontier).correctness
        : null,
      outcomeIntersection: {
        advisorRegression,
        advisorRescue,
        allModesPass,
        comparablePairs: allModePairs,
        lunaOnly,
        missingPairs: allModeMissing,
        solOnly,
      },
      rescue: {
        failedSmallBaseline: smallFailures,
        insufficient: runs < 2,
        rate: smallFailures ? advisorRescue / smallFailures : null,
        regressionRate:
          advisorPairs - smallFailures
            ? advisorRegression / (advisorPairs - smallFailures)
            : null,
        regressions: advisorRegression,
        rescued: advisorRescue,
        threshold: 0.5,
      },
      scoutOverhead: {
        advisorInputTokenDelta:
          scoutAdvisorInputMean !== null && advisorInputMean !== null
            ? scoutAdvisorInputMean - advisorInputMean
            : null,
        calls: scoutRecords.reduce(
          (sum, record) => sum + record.scout.calls,
          0
        ),
        correctnessDelta: delta(
          scoutAggregate.correctness,
          advisorAggregate.correctness,
          scoutComparable
        ),
        costDelta:
          scoutAggregate.meanCost !== null && advisorCost !== null
            ? scoutAggregate.meanCost - advisorCost
            : null,
        tokenDelta:
          scoutRecords.length > 0 &&
          scoutRecords.every((record) => record.scout.totalTokens !== null)
            ? scoutRecords.reduce(
                (sum, record) => sum + (record.scout.totalTokens ?? 0),
                0
              )
            : null,
      },
      scoutTransitions: {
        advisorFailScoutPass: scoutAdvisorFail,
        advisorPassScoutFail: scoutAdvisorPass,
        comparablePairs: scoutComparable,
        missingPairs: scoutMissing,
        unchangedFail,
        unchangedPass,
      },
      speedDelta:
        byMode.advisor.speedIndex !== null &&
        byMode["small-baseline"].speedIndex !== null
          ? byMode["small-baseline"].speedIndex - byMode.advisor.speedIndex
          : null,
    },
    generatedAt: new Date().toISOString(),
    inputPath,
    modes: byMode,
    pairedDiagnostics,
    runs,
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    seed,
    warnings,
  };
};

const table = (report: BenchmarkReport, showAdvisorUsage = true) =>
  [
    "| Mode | Success | Completed validation | Mean cost | Cost coverage | Cost / success | Median duration | Timeout | Advisor calls |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...ALL_MODES.filter((mode) => report.modes[mode].attempts > 0).map(
      (mode) => {
        const m = report.modes[mode];
        const calls =
          showAdvisorUsage && mode !== "baseline" && mode !== "small-baseline"
            ? report.comparisons.advisorCallsPerAttempt
            : 0;
        return `| ${mode} | ${pct(m.correctness)} (${m.successes}/${m.attempts}) | ${pct(m.completedValidationRate)} (${m.successes}/${m.completedRuns}) | ${money(m.meanCost)} | ${m.costCoverage}/${m.attempts} | ${money(m.costPerSuccess)} (${m.costPerSuccessCoverage}) | ${duration(m.medianDurationMs)} | ${pct(m.timeoutRate)} | ${calls === null ? "N/A" : calls.toFixed(2)} |`;
      }
    ),
  ].join("\n");

export const renderMarkdown = (report: BenchmarkReport) =>
  `# Pi Advisor Benchmark Report\n\nGenerated ${report.generatedAt}. Results: \`${report.inputPath}\`.\n\n## Summary\n\n${table(report)}\n\nCost values are means over runs with available provider usage; coverage is shown explicitly and missing usage is never treated as zero. Cost per success shows the number of successful runs with known cost.\n\n## Failure classification\n\n${ALL_MODES.filter(
    (mode) => report.modes[mode].attempts > 0
  )
    .map((mode) => {
      const f = report.modes[mode].failures;
      const invariants = Object.entries(report.modes[mode].failureInvariants)
        .map(([name, count]) => `${name} (${count})`)
        .join(", ");
      return `- **${mode}**: validation failures ${f.validationFailure}, agent timeouts ${f.agentTimeout}, validator timeouts ${f.validatorTimeout}, provider failures ${f.providerFailure}, infrastructure failures ${f.infrastructureFailure}, agent failures ${f.agentFailure}${invariants ? `; validator invariants: ${invariants}` : ""}.`;
    })
    .join("\n")}\n\n## Executor budget distributions\n\n${ALL_MODES.filter(
    (mode) => report.modes[mode].attempts > 0
  )
    .map((mode) => {
      const observed = report.modes[mode].observed;
      const format = (value: {
        median: number | null;
        p90: number | null;
        max: number | null;
      }) =>
        `${value.median ?? "N/A"}/${value.p90 ?? "N/A"}/${value.max ?? "N/A"}`;
      return `- **${mode}** calls ${format(observed.modelCalls)}, input ${format(observed.inputTokens)}, output ${format(observed.outputTokens)}, cached ${format(observed.cachedTokens)}, tool calls ${format(observed.toolCalls)}, agent turns ${format(observed.agentTurns)} (median/p90/max).`;
    })
    .join(
      "\\n"
    )}\n\n## Paired outcomes\n\n- All modes pass: ${report.comparisons.outcomeIntersection.allModesPass}\n- Sol only: ${report.comparisons.outcomeIntersection.solOnly}\n- Luna only: ${report.comparisons.outcomeIntersection.lunaOnly}\n- Advisor rescue (Luna fail → Advisor pass): ${report.comparisons.outcomeIntersection.advisorRescue}\n- Advisor regression (Luna pass → Advisor fail): ${report.comparisons.outcomeIntersection.advisorRegression}\n- Comparable all-mode pairs: ${report.comparisons.outcomeIntersection.comparablePairs}; missing at least one mode: ${report.comparisons.outcomeIntersection.missingPairs}\n\n## Advisor and Scout diagnostics\n\n- Advisor rescue rate: ${pct(report.comparisons.rescue.rate)} (${report.comparisons.rescue.rescued}/${report.comparisons.rescue.failedSmallBaseline} Luna failures; ${report.comparisons.rescue.insufficient ? "insufficient repeated samples" : ""})\n- Advisor regression rate: ${pct(report.comparisons.rescue.regressionRate)} (${report.comparisons.rescue.regressions})\n- Scout transitions: Advisor fail → Scout pass ${report.comparisons.scoutTransitions.advisorFailScoutPass}; Advisor pass → Scout fail ${report.comparisons.scoutTransitions.advisorPassScoutFail}; unchanged pass ${report.comparisons.scoutTransitions.unchangedPass}; unchanged fail ${report.comparisons.scoutTransitions.unchangedFail}.\n- Scout cost delta: ${money(report.comparisons.scoutOverhead.costDelta)}; Scout tokens: ${report.comparisons.scoutOverhead.tokenDelta === null ? "N/A" : report.comparisons.scoutOverhead.tokenDelta}; Advisor input-token delta with Scout: ${report.comparisons.scoutOverhead.advisorInputTokenDelta === null ? "N/A" : report.comparisons.scoutOverhead.advisorInputTokenDelta}.\n\n## Category coverage\n\n${CATEGORIES.map((category) => `### ${category}\n\n${report.byCategory[category] ? table({ ...report, modes: report.byCategory[category]! } as BenchmarkReport, false) : "N/A"}`).join("\n\n")}\n\n## Paired diagnostics\n\n${report.pairedDiagnostics.length ? report.pairedDiagnostics.map((item) => `- ${item.taskId}: Luna ${item.smallBaseline ? "pass" : "fail"}, Advisor ${item.advisor ? "pass" : "fail"}`).join("\n") : "None observed."}\n\n## Warnings\n\n${report.warnings.length ? report.warnings.map((warning) => `- ${warning}`).join("\n") : "None."}\n`;

export const writeReport = (
  report: BenchmarkReport,
  markdownPath: string,
  jsonPath: string
) => {
  writeFileSync(markdownPath, renderMarkdown(report));
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
};
