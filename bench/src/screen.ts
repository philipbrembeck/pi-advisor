/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: screening keeps the preregistration gate, budget, trials, and strata in one auditable path. */
/* biome-ignore-all lint/performance/noAwaitInLoops: screening reserves and records one task/seed trial at a time for deterministic artifacts. */
import { resolve } from "node:path";
import {
  BudgetGuard,
  formatBudgetEstimate,
  validateBudgetPlan,
} from "./budget.js";
import { DEFAULT_CONFIG, defaultPricingFor, modelPin } from "./config.js";
import { defaultControlAdvice, runControls } from "./controls.js";
import { hashTree } from "./fixture.js";
import { createPiAdvisorHarborAdapter } from "./pi-advisor-adapter.js";
import { assertPinnedLiveModelConfiguration } from "./pins.js";
import { requireCommittedPreregistration } from "./preregistration.js";
import {
  assertReactBenchCheckout,
  discoverReactBenchTasks,
  type ReactBenchTrialResult,
  type ReactBenchTrialRunner,
} from "./reactbench.js";
import { reportFor, writeReport } from "./report.js";
import {
  candidateBandPrevalence,
  classifyScreeningPool,
  selectTrivialStratum,
  validateEvaluationSeeds,
} from "./screening.js";
import { EVALUATION_SEEDS, SCREENING_SEEDS } from "./seeds.js";
import type { BenchmarkConfig, BenchmarkReport, ModelPin } from "./types.js";

const SCREENING_TASK_COUNT = 30;
const TRIVIAL_STRATUM_SIZE = 3;
const PREREG_SECTION_ONE = /## §1|## Section 1|Band classification/;
const TOKEN_ASSUMPTION = { input: 12_000, output: 4000 };

export interface ScreeningTrial extends ReactBenchTrialResult {
  arm: "E" | "F";
  seed: number;
}

export interface ScreeningRunOptions {
  announceBudget?: boolean;
  config?: BenchmarkConfig;
  reportTimestamp?: string;
  runner?: ReactBenchTrialRunner;
  sourceRoot?: string;
  writeReportOutput?: boolean;
}

const preregistered = () =>
  requireCommittedPreregistration(PREREG_SECTION_ONE, "Stage 1 screening");

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
    "screen",
    config,
    {
      candidateBandPrevalence: null,
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

const trialRequest = (
  taskPath: string,
  artifactRoot: string,
  arm: "E" | "F",
  seed: number,
  config: BenchmarkConfig,
  budgetUsd: number
) => {
  const executor =
    arm === "E"
      ? modelPin(config, "executor", "executor")
      : modelPin(config, "frontier", "executor");
  return {
    advisor: undefined,
    arm,
    artifactRoot,
    budgetUsd,
    executor,
    pricing: { executor: pricingFor(config, executor) },
    seed,
    taskPath,
  };
};

export const runScreening = async ({
  announceBudget = true,
  config = DEFAULT_CONFIG,
  runner,
  reportTimestamp,
  sourceRoot = process.env.BENCH_REACTBENCH_ROOT,
  writeReportOutput = true,
}: ScreeningRunOptions = {}): Promise<BenchmarkReport> => {
  preregistered();
  validateEvaluationSeeds(SCREENING_SEEDS, EVALUATION_SEEDS);
  assertPinnedLiveModelConfiguration(config);
  if (!sourceRoot) {
    const report = unavailable(
      config,
      "BENCH_REACTBENCH_ROOT is not set; Harbor/ReactBench screening was not run.",
      reportTimestamp
    );
    if (writeReportOutput) {
      writeReport(report, undefined, config.reportRoot);
    }
    return report;
  }
  let harborRunnerCreated = false;
  if (!runner) {
    const command =
      process.env.BENCH_PI_ADVISOR_ADAPTER ??
      process.env.BENCH_PI_ADAPTER ??
      process.env.BENCH_REACTBENCH_RUNNER;
    if (!command) {
      const report = unavailable(
        config,
        "BENCH_REACTBENCH_RUNNER is not set; no Pi/ReactBench adapter is available.",
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
    harborRunnerCreated = true;
  }
  if (harborRunnerCreated) {
    assertReactBenchCheckout(sourceRoot, config.reactBenchCommit);
  }
  const tasks = discoverReactBenchTasks(sourceRoot, SCREENING_TASK_COUNT);
  const executorPin = modelPin(config, "executor", "executor");
  const frontierPin = modelPin(config, "frontier", "executor");
  if (
    pricingUnavailable(config, executorPin) ||
    pricingUnavailable(config, frontierPin)
  ) {
    const report = unavailable(
      config,
      "Screening pricing is unavailable for the pinned Executor or frontier arm; no spend was imputed.",
      reportTimestamp
    );
    if (writeReportOutput) {
      writeReport(report, undefined, config.reportRoot);
    }
    return report;
  }
  const perExecutor = pricingFor(config, executorPin);
  const perFrontier = pricingFor(config, frontierPin);
  const expectedCalls = tasks.length * SCREENING_SEEDS.length * 2;
  const estimatedUsd =
    (expectedCalls / 2) *
      ((TOKEN_ASSUMPTION.input * perExecutor.inputPerMillion +
        TOKEN_ASSUMPTION.output * perExecutor.outputPerMillion) /
        1_000_000) +
    (expectedCalls / 2) *
      ((TOKEN_ASSUMPTION.input * perFrontier.inputPerMillion +
        TOKEN_ASSUMPTION.output * perFrontier.outputPerMillion) /
        1_000_000);
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
      `Estimated screening spend $${estimatedUsd.toFixed(4)} exceeds $${config.budgetUsd.toFixed(4)} cap.`
    );
  }
  const budget = new BudgetGuard(config.budgetUsd);
  const trials: ScreeningTrial[] = [];
  const root = resolve("bench/reports/screening-trajectories");
  for (const task of tasks) {
    for (const arm of ["E", "F"] as const) {
      const pin = arm === "E" ? executorPin : frontierPin;
      for (const seed of SCREENING_SEEDS) {
        const pricing = pricingFor(config, pin);
        const reserve = budget.reserve(
          (TOKEN_ASSUMPTION.input * pricing.inputPerMillion +
            TOKEN_ASSUMPTION.output * pricing.outputPerMillion) /
            1_000_000
        );
        // The baseline reserve belongs to this trial; the proxy lease may
        // spend that reserve as well as the still-unreserved remainder.
        const trialBudget = budget.remainingUsd() + reserve;
        if (!(trialBudget > 0)) {
          throw new Error(
            "Benchmark budget is exhausted before the next provider trial."
          );
        }
        const result = await runner.run(
          trialRequest(task.path, root, arm, seed, config, trialBudget)
        );
        if (result.cost === "unavailable") {
          throw new Error(
            "Provider usage is unavailable; refusing to continue after an unpriced screening trial."
          );
        }
        budget.settle(reserve, result.cost);
        trials.push({ ...result, arm, seed, taskId: task.taskId });
      }
    }
  }
  const classified = classifyScreeningPool(
    tasks.map((task) => ({
      executorPasses: trials
        .filter((trial) => trial.taskId === task.taskId && trial.arm === "E")
        .sort((left, right) => left.seed - right.seed)
        .map((trial) => trial.passed),
      frontierPasses: trials
        .filter((trial) => trial.taskId === task.taskId && trial.arm === "F")
        .sort((left, right) => left.seed - right.seed)
        .map((trial) => trial.passed),
      taskId: task.taskId,
    }))
  );
  const trivialCount = classified.filter(
    (result) => result.candidateBand === "trivial"
  ).length;
  const trivial = selectTrivialStratum(
    classified,
    Math.min(TRIVIAL_STRATUM_SIZE, trivialCount),
    config.seed
  );
  const candidate = classified.filter(
    (result) => result.candidateBand === "candidate-uplift"
  );
  const controlRun = runControls(
    resolve(config.fixtureRoot, "controls"),
    defaultControlAdvice
  );
  const report = reportFor(
    "screen",
    config,
    {
      budget: budget.snapshot(),
      candidateBandPrevalence: candidateBandPrevalence(classified),
      candidateBandPrevalenceLabel:
        "proxy: E fails ∧ F passes; true band is an E+A property",
      candidateTaskIds: candidate.map((result) => result.taskId),
      controls: controlRun.scores,
      evaluationSeeds: [...EVALUATION_SEEDS],
      screeningSeeds: [...SCREENING_SEEDS],
      tasks: classified,
      trajectories: trials,
      trivialStratumTaskIds: trivial.map((result) => result.taskId),
      trivialTaskCount: trivialCount,
    },
    {
      budget: estimate,
      controls: controlRun.controls,
      fixtureHashes: { reactBench: hashTree(sourceRoot) },
      gateSettings: {
        evaluationSeeds: EVALUATION_SEEDS,
        screeningSeeds: SCREENING_SEEDS,
      },
      generatedAt: reportTimestamp,
      status:
        controlRun.controls.invalid || trivialCount < TRIVIAL_STRATUM_SIZE
          ? "INVALID"
          : "PASS",
      warnings: [
        ...(trivialCount < TRIVIAL_STRATUM_SIZE
          ? [
              `Only ${trivialCount} trivial tasks were screened; Stage 2 requires at least ${TRIVIAL_STRATUM_SIZE}.`,
            ]
          : []),
        ...(controlRun.controls.invalid
          ? ["Null/oracle controls invalidated this live run."]
          : []),
        ...(candidate.length === 0
          ? [
              "NO HEADROOM: the candidate-uplift proxy band is empty; this is a valid result.",
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
