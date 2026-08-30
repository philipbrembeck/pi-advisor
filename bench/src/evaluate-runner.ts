/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: the evaluation runner keeps preregistration, strata, paired outcomes, budget, and plots auditable in one path. */
/* biome-ignore-all lint/performance/noAwaitInLoops: evaluation serializes task/seed trials so paired artifacts and budget reservations stay deterministic. */
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  BudgetGuard,
  formatBudgetEstimate,
  validateBudgetPlan,
} from "./budget.js";
import { DEFAULT_CONFIG, defaultPricingFor, modelPin } from "./config.js";
import { defaultControlAdvice, runControls } from "./controls.js";
import {
  aggregateEvaluation,
  breakEvenConsultations,
  type CostQualityPoint,
  dominanceVerdict,
  type EvaluationArm,
  type EvaluationOutcome,
  q2Report,
  renderCostQualityPlot,
  reweightCostQuality,
} from "./evaluate.js";
import { hashFile, hashTree } from "./fixture.js";
import { createPiAdvisorHarborAdapter } from "./pi-advisor-adapter.js";
import { requireCommittedPreregistration } from "./preregistration.js";
import {
  discoverReactBenchTasks,
  type ReactBenchTrialResult,
  type ReactBenchTrialRunner,
} from "./reactbench.js";
import { readReport, reportFor, writeReport } from "./report.js";
import { validateEvaluationSeeds } from "./screening.js";
import { EVALUATION_SEEDS, SCREENING_SEEDS } from "./seeds.js";
import type {
  BandScreenResult,
  BenchmarkConfig,
  BenchmarkReport,
  ModelPin,
} from "./types.js";

const TOKEN_ASSUMPTION = { input: 12_000, output: 4000 };
const MIN_TRIVIAL_TASKS = 3;
const QUALITY_FRACTION = 0.9;
const PREREG_SECTION_TWO = /## §2|## Section 2|Value decision/;

export interface EvaluationRunOptions {
  announceBudget?: boolean;
  config?: BenchmarkConfig;
  reportTimestamp?: string;
  runner?: ReactBenchTrialRunner;
  screeningReportPath?: string;
  writeReportOutput?: boolean;
}

interface ScreeningTrialRecord {
  arm: "E" | "F";
  cost: number | "unavailable";
  passed: boolean;
  seed: number;
  taskId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const latestScreeningReport = (
  reportRoot = resolve("bench/reports")
) => {
  if (!existsSync(reportRoot)) {
    return;
  }
  const name = readdirSync(reportRoot)
    .filter((value) => value.endsWith("-screen.json"))
    .sort()
    .at(-1);
  return name ? resolve(reportRoot, name) : undefined;
};

const readScreening = (
  path: string
): {
  report: BenchmarkReport;
  results: BandScreenResult[];
  trials: ScreeningTrialRecord[];
  trivialStratumTaskIds: string[];
} => {
  const report = readReport(path);
  const rawResults = report.metrics.tasks;
  const rawTrials = report.metrics.trajectories;
  const rawTrivial = report.metrics.trivialStratumTaskIds;
  if (
    !(
      Array.isArray(rawResults) &&
      Array.isArray(rawTrials) &&
      Array.isArray(rawTrivial)
    )
  ) {
    throw new TypeError(
      "Screening report is missing task assignments or trajectories."
    );
  }
  const results = rawResults.map((value) => {
    if (!isRecord(value) || typeof value.taskId !== "string") {
      throw new TypeError("Malformed screening task assignment.");
    }
    return value as unknown as BandScreenResult;
  });
  const trials = rawTrials.map((value) => {
    if (
      !isRecord(value) ||
      (value.arm !== "E" && value.arm !== "F") ||
      typeof value.taskId !== "string" ||
      typeof value.seed !== "number" ||
      typeof value.passed !== "boolean"
    ) {
      throw new TypeError("Malformed screening trajectory.");
    }
    const { cost } = value;
    if (
      cost !== "unavailable" &&
      (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)
    ) {
      throw new TypeError("Malformed screening trajectory cost.");
    }
    return {
      arm: value.arm as "E" | "F",
      cost: cost as number | "unavailable",
      passed: value.passed,
      seed: value.seed,
      taskId: value.taskId,
    };
  });
  const trivialStratumTaskIds = rawTrivial.filter(
    (value): value is string => typeof value === "string"
  );
  return { report, results, trials, trivialStratumTaskIds };
};

const unavailable = (
  config: BenchmarkConfig,
  message: string,
  reportTimestamp?: string
) => {
  const controlRun = runControls(
    resolve(config.fixtureRoot, "controls"),
    defaultControlAdvice
  );
  return reportFor(
    "evaluate",
    config,
    {
      controlSource: "deterministic fixture controls only",
      controls: controlRun.scores,
      status: "UNAVAILABLE",
    },
    {
      controls: controlRun.controls,
      fixtureHashes: {
        controls: hashTree(resolve(config.fixtureRoot, "controls")),
      },
      generatedAt: reportTimestamp,
      status: "UNAVAILABLE",
      warnings: [message],
    }
  );
};

const pricingFor = (config: BenchmarkConfig, pin: ModelPin) =>
  defaultPricingFor(config, pin.model) ?? {
    cacheReadPerMillion: 0,
    cacheWritePerMillion: 0,
    inputPerMillion: 0,
    outputPerMillion: 0,
  };

const pricingUnavailable = (config: BenchmarkConfig, pin: ModelPin) =>
  Object.values(pricingFor(config, pin)).every((rate) => rate === 0);

const averageCost = (
  outcomes: readonly { cost: number | "unavailable" }[]
): number | "unavailable" => {
  if (
    outcomes.length === 0 ||
    outcomes.some((outcome) => outcome.cost === "unavailable")
  ) {
    return "unavailable";
  }
  return (
    outcomes.reduce((sum, outcome) => sum + (outcome.cost as number), 0) /
    outcomes.length
  );
};

const evaluatedPoint = (
  arm: EvaluationArm,
  taskIds: readonly string[],
  outcomes: readonly EvaluationOutcome[],
  aggregates: ReturnType<typeof aggregateEvaluation>
): CostQualityPoint => {
  const selected = outcomes.filter(
    (outcome) => outcome.arm === arm && taskIds.includes(outcome.taskId)
  );
  const selectedAggregates = aggregates.filter(
    (aggregate) => aggregate.arm === arm && taskIds.includes(aggregate.taskId)
  );
  return {
    arm,
    costPerTask: averageCost(selected),
    passRate: selectedAggregates.length
      ? selectedAggregates.filter((aggregate) => aggregate.passed).length /
        selectedAggregates.length
      : 0,
    taskCount: selectedAggregates.length,
  };
};

const screeningPoint = (
  arm: "E" | "F",
  taskIds: readonly string[],
  trials: readonly ScreeningTrialRecord[],
  forceZero = false
): CostQualityPoint => {
  const selected = trials.filter(
    (trial) => trial.arm === arm && taskIds.includes(trial.taskId)
  );
  const byTask = new Map<string, ScreeningTrialRecord[]>();
  for (const trial of selected) {
    const task = byTask.get(trial.taskId) ?? [];
    task.push(trial);
    byTask.set(trial.taskId, task);
  }
  const taskPasses = [...byTask.values()];
  let passRate = 0;
  if (!forceZero && taskPasses.length > 0) {
    passRate =
      taskPasses.filter(
        (task) => task.filter((trial) => trial.passed).length >= 1
      ).length / taskPasses.length;
  }
  return {
    arm,
    costPerTask: averageCost(selected),
    passRate,
    taskCount: taskPasses.length,
  };
};

const pointsForStratum = (
  taskIds: readonly string[],
  evaluated: readonly EvaluationOutcome[],
  aggregates: ReturnType<typeof aggregateEvaluation>,
  trials: readonly ScreeningTrialRecord[],
  includeFMedium: boolean,
  outOfReach = false
) => {
  const points: CostQualityPoint[] = [
    evaluatedPoint("E", taskIds, evaluated, aggregates),
    evaluatedPoint("E+A", taskIds, evaluated, aggregates),
    screeningPoint("F", taskIds, trials, outOfReach),
  ];
  if (outOfReach) {
    const executor = screeningPoint("E", taskIds, trials, true);
    const flow: CostQualityPoint = {
      arm: "E+A",
      costPerTask: executor.costPerTask,
      passRate: 0,
      taskCount: executor.taskCount,
    };
    points[0] = executor;
    points[1] = flow;
  }
  if (includeFMedium) {
    points.push({
      ...screeningPoint("F", taskIds, trials, outOfReach),
      arm: "F′",
    });
  }
  return points;
};

const consultationFrequency = (
  taskIds: readonly string[],
  outcomes: readonly EvaluationOutcome[]
) => {
  const selected = outcomes.filter(
    (outcome) => outcome.arm === "E+A" && taskIds.includes(outcome.taskId)
  );
  return selected.length
    ? selected.reduce((sum, outcome) => sum + outcome.consultations, 0) /
        selected.length
    : 0;
};

export const runEvaluation = async ({
  announceBudget = true,
  config = DEFAULT_CONFIG,
  runner,
  reportTimestamp,
  screeningReportPath = process.env.BENCH_SCREEN_REPORT ??
    latestScreeningReport(),
  writeReportOutput = true,
}: EvaluationRunOptions = {}): Promise<BenchmarkReport> => {
  if (!screeningReportPath) {
    const report = unavailable(
      config,
      "No completed Stage 1 screening report is available; evaluation did not run.",
      reportTimestamp
    );
    if (writeReportOutput) {
      writeReport(report, undefined, config.reportRoot);
    }
    return report;
  }
  requireCommittedPreregistration(PREREG_SECTION_TWO, "Stage 2 evaluation");
  const screening = readScreening(screeningReportPath);
  const reactBenchFixtureHash = screening.report.pins.fixtureHashes.reactBench;
  if (screening.report.status !== "PASS") {
    const report = unavailable(
      config,
      `Screening report status is ${screening.report.status}; Stage 2 did not run.`,
      reportTimestamp
    );
    if (writeReportOutput) {
      writeReport(report, undefined, config.reportRoot);
    }
    return report;
  }
  validateEvaluationSeeds(SCREENING_SEEDS, EVALUATION_SEEDS);
  const candidateIds = screening.results
    .filter((result) => result.candidateBand === "candidate-uplift")
    .map((result) => result.taskId);
  const allTrivialIds = screening.results
    .filter((result) => result.candidateBand === "trivial")
    .map((result) => result.taskId);
  const trivialIds = screening.trivialStratumTaskIds.filter((taskId) =>
    screening.results.some(
      (result) => result.taskId === taskId && result.candidateBand === "trivial"
    )
  );
  const outOfReachIds = screening.results
    .filter((result) => result.candidateBand === "out-of-reach")
    .map((result) => result.taskId);
  const controlRun = runControls(
    resolve(config.fixtureRoot, "controls"),
    defaultControlAdvice
  );
  const prevalence =
    candidateIds.length / Math.max(1, screening.results.length);
  const trivialPrevalence =
    allTrivialIds.length / Math.max(1, screening.results.length);
  const outOfReachPrevalence =
    outOfReachIds.length / Math.max(1, screening.results.length);
  if (candidateIds.length === 0) {
    const report = reportFor(
      "evaluate",
      config,
      {
        candidateBandPrevalence: prevalence,
        candidateBandPrevalenceLabel: "proxy: E fails ∧ F passes",
        controls: controlRun.scores,
        q2: q2Report([]),
        verdict: "NO HEADROOM",
      },
      {
        controls: controlRun.controls,
        fixtureHashes: {
          controls: hashTree(resolve(config.fixtureRoot, "controls")),
          reactBench: reactBenchFixtureHash,
          screeningReport: hashFile(screeningReportPath),
        },
        generatedAt: reportTimestamp,
        status: controlRun.controls.invalid ? "INVALID" : "PASS",
        warnings: [
          "NO HEADROOM: the screened candidate-uplift proxy band is empty.",
        ],
      }
    );
    if (writeReportOutput) {
      writeReport(report, undefined, config.reportRoot);
    }
    return report;
  }
  if (trivialIds.length < MIN_TRIVIAL_TASKS) {
    const report = unavailable(
      config,
      `Screening produced only ${trivialIds.length} trivial tasks; Stage 2 requires at least ${MIN_TRIVIAL_TASKS}.`,
      reportTimestamp
    );
    if (writeReportOutput) {
      writeReport(report, undefined, config.reportRoot);
    }
    return report;
  }
  if (!runner) {
    const sourceRoot = process.env.BENCH_REACTBENCH_ROOT;
    const command =
      process.env.BENCH_PI_ADVISOR_ADAPTER ??
      process.env.BENCH_PI_ADAPTER ??
      process.env.BENCH_REACTBENCH_RUNNER;
    if (!(sourceRoot && command)) {
      const report = unavailable(
        config,
        "BENCH_REACTBENCH_ROOT and BENCH_REACTBENCH_RUNNER are required for Stage 2.",
        reportTimestamp
      );
      if (writeReportOutput) {
        writeReport(report, undefined, config.reportRoot);
      }
      return report;
    }
    runner = createPiAdvisorHarborAdapter(command);
    if (!runner) {
      throw new Error("Pi ReactBench adapter could not be initialized.");
    }
  }
  const includeFMedium = process.env.BENCH_FRONTIER_MEDIUM === "1";
  const arms: EvaluationArm[] = ["E", "E+A", "F"];
  if (includeFMedium) {
    arms.push("F′");
  }
  const expectedCalls =
    candidateIds.length * EVALUATION_SEEDS.length * (arms.length + 1) +
    trivialIds.length * EVALUATION_SEEDS.length * 3;
  const pins = {
    advisor: modelPin(config, "decisionAdvisor", "advisor"),
    executor: modelPin(config, "executor", "executor"),
    frontier: modelPin(config, "frontier", "executor"),
    frontierMedium: modelPin(config, "frontierMedium", "executor"),
  };
  if (
    pricingUnavailable(config, pins.executor) ||
    pricingUnavailable(config, pins.advisor) ||
    pricingUnavailable(config, pins.frontier) ||
    (includeFMedium && pricingUnavailable(config, pins.frontierMedium))
  ) {
    const report = unavailable(
      config,
      "Evaluation pricing is unavailable for one of the pinned arms; no spend was imputed.",
      reportTimestamp
    );
    if (writeReportOutput) {
      writeReport(report, undefined, config.reportRoot);
    }
    return report;
  }
  const perCall = (pin: ModelPin) => {
    const pricing = pricingFor(config, pin);
    return (
      (TOKEN_ASSUMPTION.input * pricing.inputPerMillion +
        TOKEN_ASSUMPTION.output * pricing.outputPerMillion) /
      1_000_000
    );
  };
  const estimatedUsd =
    candidateIds.length *
      EVALUATION_SEEDS.length *
      (perCall(pins.executor) +
        perCall(pins.executor) +
        perCall(pins.advisor) +
        perCall(pins.frontier)) +
    trivialIds.length *
      EVALUATION_SEEDS.length *
      (perCall(pins.executor) +
        perCall(pins.executor) +
        perCall(pins.advisor)) +
    (includeFMedium
      ? candidateIds.length *
        EVALUATION_SEEDS.length *
        perCall(pins.frontierMedium)
      : 0);
  const estimate = validateBudgetPlan({
    capUsd: config.budgetUsd,
    estimatedUsd,
    expectedCalls,
    maxCalls: expectedCalls,
    tokenAssumption: TOKEN_ASSUMPTION,
  });
  if (announceBudget) {
    console.log(formatBudgetEstimate(estimate));
  }
  if (estimatedUsd > config.budgetUsd) {
    throw new Error(
      `Estimated evaluation spend $${estimatedUsd.toFixed(4)} exceeds $${config.budgetUsd.toFixed(4)} cap.`
    );
  }
  const activeRunner = runner;
  if (!activeRunner) {
    throw new Error("Stage 2 runner was not initialized.");
  }
  const budget = new BudgetGuard(config.budgetUsd);
  const outcomes: EvaluationOutcome[] = [];
  const runTask = async (
    taskId: string,
    taskPath: string,
    arm: EvaluationArm,
    seed: number
  ) => {
    const { executor: defaultExecutor, frontier, frontierMedium } = pins;
    let executor = defaultExecutor;
    if (arm === "F") {
      executor = frontier;
    } else if (arm === "F′") {
      executor = frontierMedium;
    }
    const advisor = arm === "E+A" ? pins.advisor : undefined;
    const reserve = budget.reserve(
      perCall(executor) + (advisor ? perCall(advisor) : 0)
    );
    const result: ReactBenchTrialResult = await activeRunner.run({
      advisor,
      arm,
      artifactRoot: resolve("bench/reports/evaluation-trajectories"),
      executor,
      seed,
      taskPath,
    });
    budget.settle(
      reserve,
      result.cost === "unavailable" ? undefined : result.cost
    );
    outcomes.push({
      arm,
      consultations: result.consultations,
      cost: result.cost,
      passed: result.passed,
      seed,
      taskId,
    });
  };
  const tasks = process.env.BENCH_REACTBENCH_ROOT
    ? discoverReactBenchTasks(
        process.env.BENCH_REACTBENCH_ROOT,
        screening.results.length
      )
    : [];
  const pathById = new Map(tasks.map((task) => [task.taskId, task.path]));
  for (const taskId of [...candidateIds, ...trivialIds]) {
    const taskPath = pathById.get(taskId) ?? taskId;
    const taskArms = candidateIds.includes(taskId)
      ? arms
      : (["E", "E+A"] as const);
    for (const arm of taskArms) {
      for (const seed of EVALUATION_SEEDS) {
        await runTask(taskId, taskPath, arm, seed);
      }
    }
  }
  const aggregates = aggregateEvaluation(outcomes);
  const q2 = q2Report(
    aggregates,
    { trivial: trivialIds, uplift: candidateIds },
    outcomes
  );
  const upliftPoints = pointsForStratum(
    candidateIds,
    outcomes,
    aggregates,
    screening.trials,
    includeFMedium
  );
  const trivialPoints = pointsForStratum(
    trivialIds,
    outcomes,
    aggregates,
    screening.trials,
    includeFMedium
  );
  const outPoints = pointsForStratum(
    outOfReachIds,
    outcomes,
    aggregates,
    screening.trials,
    includeFMedium,
    true
  );
  const reweighted = reweightCostQuality([
    { points: upliftPoints, prevalence },
    { points: trivialPoints, prevalence: trivialPrevalence },
    { points: outPoints, prevalence: outOfReachPrevalence },
  ]);
  const dominance = dominanceVerdict(reweighted, QUALITY_FRACTION);
  const point = (points: readonly CostQualityPoint[], arm: EvaluationArm) =>
    points.find((value) => value.arm === arm);
  const upliftE = point(upliftPoints, "E");
  const upliftEA = point(upliftPoints, "E+A");
  const upliftF = point(upliftPoints, "F");
  const trivialE = point(trivialPoints, "E");
  const trivialEA = point(trivialPoints, "E+A");
  const advisorUnitCost = (
    executor: CostQualityPoint | undefined,
    flow: CostQualityPoint | undefined,
    taskIds: readonly string[]
  ) => {
    if (
      !(executor && flow) ||
      executor.costPerTask === "unavailable" ||
      flow.costPerTask === "unavailable"
    ) {
      return "unavailable" as const;
    }
    return (
      (flow.costPerTask - executor.costPerTask) /
      Math.max(1, consultationFrequency(taskIds, outcomes))
    );
  };
  const breakEven = {
    trivial: breakEvenConsultations(
      trivialE?.costPerTask ?? "unavailable",
      screeningPoint("F", trivialIds, screening.trials).costPerTask,
      advisorUnitCost(trivialE, trivialEA, trivialIds)
    ),
    uplift: breakEvenConsultations(
      upliftE?.costPerTask ?? "unavailable",
      upliftF?.costPerTask ?? "unavailable",
      advisorUnitCost(upliftE, upliftEA, candidateIds)
    ),
  };
  let reportStatus: BenchmarkReport["status"] = "PASS";
  if (controlRun.controls.invalid) {
    reportStatus = "INVALID";
  } else if (dominance.status === "unavailable") {
    reportStatus = "UNAVAILABLE";
  }
  const report = reportFor(
    "evaluate",
    config,
    {
      breakEvenConsultations: breakEven,
      budget: budget.snapshot(),
      candidateBandPrevalence: prevalence,
      candidateBandPrevalenceLabel:
        "proxy: E fails ∧ F passes; true band is an E+A property",
      consultationFrequency: {
        trivial: consultationFrequency(trivialIds, outcomes),
        uplift: consultationFrequency(candidateIds, outcomes),
      },
      controls: controlRun.scores,
      dominance: {
        diagnosticUplift: dominanceVerdict(upliftPoints, QUALITY_FRACTION),
        reweighted: dominance,
      },
      plots: {
        reweighted: renderCostQualityPlot(
          reweighted,
          "Candidate-prevalence reweighted"
        ),
        uplift: renderCostQualityPlot(upliftPoints, "Candidate-uplift stratum"),
      },
      q2,
      screeningReport: screeningReportPath,
      strata: {
        outOfReach: outPoints,
        trivial: trivialPoints,
        uplift: upliftPoints,
      },
      taskAggregates: aggregates,
      trialOutcomes: outcomes,
      verdict: dominance.verdict,
    },
    {
      budget: estimate,
      controls: controlRun.controls,
      fixtureHashes: {
        controls: hashTree(resolve(config.fixtureRoot, "controls")),
        reactBench: reactBenchFixtureHash,
        screeningReport: hashFile(screeningReportPath),
      },
      gateSettings: {
        evaluationSeeds: EVALUATION_SEEDS,
        qualityFraction: QUALITY_FRACTION,
      },
      generatedAt: reportTimestamp,
      status: reportStatus,
      warnings: [
        ...(controlRun.controls.invalid
          ? ["Null/oracle controls invalidated this live run."]
          : []),
        "Q2 is a direction-only task-level paired result; per-seed counts are descriptive and are not independent observations.",
        "The reweighted Q3 point is the headline; the uplift-only point is diagnostic.",
        ...(outOfReachIds.length === 0
          ? [
              "No out-of-reach tasks were screened; reweighting has no out-of-reach contribution.",
            ]
          : []),
      ],
    }
  );
  if (writeReportOutput) {
    writeReport(report, undefined, config.reportRoot);
  }
  return report;
};
