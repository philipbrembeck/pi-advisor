import type { ArmName, CostValue, DiscordantPairs } from "./types.js";

export type EvaluationArm = "E" | "E+A" | "F" | "F′";

export interface EvaluationOutcome {
  arm: EvaluationArm;
  consultations: number;
  cost: CostValue;
  passed: boolean;
  seed: number;
  taskId: string;
}

export interface TaskAggregate {
  arm: EvaluationArm;
  passed: boolean;
  seedPasses: boolean[];
  taskId: string;
}

const integer = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer.`);
  }
};

/** Majority aggregation is the only seed reduction permitted by §2. */
export const aggregateTaskOutcome = (
  outcomes: readonly EvaluationOutcome[],
  expectedSeeds = 5
): TaskAggregate => {
  if (outcomes.length !== expectedSeeds) {
    throw new RangeError(
      `Task aggregation requires ${expectedSeeds} seed outcomes, found ${outcomes.length}.`
    );
  }
  const [first] = outcomes;
  if (!first) {
    throw new RangeError("Task aggregation requires at least one outcome.");
  }
  const seeds = new Set<number>();
  for (const outcome of outcomes) {
    if (outcome.taskId !== first.taskId || outcome.arm !== first.arm) {
      throw new Error("Task aggregation received mixed task or arm outcomes.");
    }
    if (seeds.has(outcome.seed)) {
      throw new Error(`Duplicate evaluation seed ${outcome.seed}.`);
    }
    seeds.add(outcome.seed);
  }
  const seedPasses = outcomes.map((outcome) => outcome.passed);
  return {
    arm: first.arm,
    passed:
      seedPasses.filter(Boolean).length >= Math.floor(expectedSeeds / 2) + 1,
    seedPasses,
    taskId: first.taskId,
  };
};

export const aggregateEvaluation = (
  outcomes: readonly EvaluationOutcome[],
  expectedSeeds = 5
): TaskAggregate[] => {
  const groups = new Map<string, EvaluationOutcome[]>();
  for (const outcome of outcomes) {
    const key = `${outcome.taskId}\0${outcome.arm}`;
    const group = groups.get(key) ?? [];
    group.push(outcome);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => aggregateTaskOutcome(group, expectedSeeds))
    .sort((left, right) =>
      `${left.taskId}\0${left.arm}`.localeCompare(
        `${right.taskId}\0${right.arm}`
      )
    );
};

const pairedDiscordance = (
  aggregates: readonly TaskAggregate[],
  leftArm: EvaluationArm,
  rightArm: EvaluationArm
): DiscordantPairs => {
  const byTask = new Map<string, Map<EvaluationArm, TaskAggregate>>();
  for (const aggregate of aggregates) {
    const task = byTask.get(aggregate.taskId) ?? new Map();
    task.set(aggregate.arm, aggregate);
    byTask.set(aggregate.taskId, task);
  }
  let executorFailAdvisorPass = 0;
  let executorPassAdvisorFail = 0;
  let taskCount = 0;
  for (const arms of byTask.values()) {
    const left = arms.get(leftArm);
    const right = arms.get(rightArm);
    if (!(left && right)) {
      continue;
    }
    taskCount += 1;
    if (!left.passed && right.passed) {
      executorFailAdvisorPass += 1;
    }
    if (left.passed && !right.passed) {
      executorPassAdvisorFail += 1;
    }
  }
  return {
    exactMcNemarPValue: exactMcNemarPValue(
      executorFailAdvisorPass,
      executorPassAdvisorFail
    ),
    executorFailAdvisorPass,
    executorPassAdvisorFail,
    taskCount,
  };
};

/** Exact two-sided McNemar p-value over task-level discordant pairs. */
export const exactMcNemarPValue = (b: number, c: number) => {
  integer(b, "b");
  integer(c, "c");
  const n = b + c;
  if (n === 0) {
    return 1;
  }
  const limit = Math.min(b, c);
  let probability = 0.5 ** n;
  let lowerTail = probability;
  for (let k = 0; k < limit; k += 1) {
    probability *= (n - k) / (k + 1);
    lowerTail += probability;
  }
  return Math.min(1, 2 * lowerTail);
};

export const mcnemarExactPValue = exactMcNemarPValue;

export const q2Report = (
  aggregates: readonly TaskAggregate[],
  strata: Record<string, readonly string[]> = {},
  outcomes: readonly EvaluationOutcome[] = []
) => {
  const all = pairedDiscordance(aggregates, "E", "E+A");
  const rawByTaskAndSeed = new Map<string, Map<EvaluationArm, boolean>>();
  for (const outcome of outcomes) {
    const key = `${outcome.taskId}\u0000${outcome.seed}`;
    const seed = rawByTaskAndSeed.get(key) ?? new Map();
    seed.set(outcome.arm, outcome.passed);
    rawByTaskAndSeed.set(key, seed);
  }
  const rawFor = (taskIds?: readonly string[]) => {
    const allowed = taskIds ? new Set(taskIds) : undefined;
    let failPass = 0;
    let passFail = 0;
    for (const [key, arms] of rawByTaskAndSeed) {
      const [taskId] = key.split("\u0000");
      if (allowed && !allowed.has(taskId)) {
        continue;
      }
      const executor = arms.get("E");
      const advisor = arms.get("E+A");
      if (executor === undefined || advisor === undefined) {
        continue;
      }
      if (!executor && advisor) {
        failPass += 1;
      }
      if (executor && !advisor) {
        passFail += 1;
      }
    }
    return {
      executorFailAdvisorPass: failPass,
      executorPassAdvisorFail: passFail,
    };
  };
  const byStratum = Object.fromEntries(
    Object.entries(strata).map(([name, taskIds]) => {
      const allowed = new Set(taskIds);
      return [
        name,
        pairedDiscordance(
          aggregates.filter((aggregate) => allowed.has(aggregate.taskId)),
          "E",
          "E+A"
        ),
      ];
    })
  );
  const rawByStratum = Object.fromEntries(
    Object.entries(strata).map(([name, taskIds]) => [name, rawFor(taskIds)])
  );
  return {
    perSeed: { all: rawFor(), byStratum: rawByStratum },
    taskLevel: { all, byStratum },
  };
};

export interface CostQualityPoint {
  arm: EvaluationArm;
  costPerTask: CostValue;
  passRate: number;
  taskCount: number;
}

export interface DominanceResult {
  flow: CostQualityPoint;
  frontier: CostQualityPoint;
  qualityFraction: number;
  status: "dominated" | "not-dominated" | "unavailable";
  verdict: "NOT_WORTH_IT" | "WORTH_CONSIDERING" | "UNAVAILABLE";
}

const weighted = (
  strata: readonly {
    prevalence: number;
    points: readonly CostQualityPoint[];
  }[]
): CostQualityPoint[] => {
  if (strata.length === 0) {
    throw new RangeError("Weighted cost/quality strata are required.");
  }
  const total = strata.reduce((sum, { prevalence }) => {
    if (!Number.isFinite(prevalence) || prevalence < 0) {
      throw new TypeError("Point prevalence must be finite and non-negative.");
    }
    return sum + prevalence;
  }, 0);
  if (!(Number.isFinite(total) && total > 0)) {
    throw new RangeError("Point prevalence must have a finite positive total.");
  }
  const positiveStrata = strata.filter(({ prevalence }) => prevalence > 0);
  for (const { points } of positiveStrata) {
    for (const point of points) {
      if (
        !Number.isFinite(point.passRate) ||
        point.passRate < 0 ||
        point.passRate > 1 ||
        (point.costPerTask !== "unavailable" &&
          (!Number.isFinite(point.costPerTask) || point.costPerTask < 0)) ||
        !Number.isSafeInteger(point.taskCount) ||
        point.taskCount < 0
      ) {
        throw new TypeError("Malformed cost/quality point.");
      }
    }
  }
  const arms = [
    ...new Set(
      positiveStrata.flatMap(({ points }) => points.map((point) => point.arm))
    ),
  ];
  if (arms.length === 0) {
    throw new RangeError("Weighted cost/quality points are required.");
  }
  for (const arm of arms) {
    if (
      positiveStrata.some(({ points }) =>
        points.every((point) => point.arm !== arm)
      )
    ) {
      throw new RangeError(
        `Weighted cost/quality arm ${arm} is missing from a positive-prevalence stratum.`
      );
    }
  }
  return arms.map((arm) => {
    const selected = strata.flatMap(({ points, prevalence }) =>
      points
        .filter((point) => point.arm === arm && prevalence > 0)
        .map((point) => ({ point, weight: prevalence }))
    );
    const unavailable = selected.some(
      ({ point }) => point.costPerTask === "unavailable"
    );
    const costPerTask = unavailable
      ? "unavailable"
      : selected.reduce(
          (sum, { point, weight }) =>
            sum + (point.costPerTask as number) * weight,
          0
        ) / total;
    return {
      arm,
      costPerTask,
      passRate:
        selected.reduce(
          (sum, { point, weight }) => sum + point.passRate * weight,
          0
        ) / total,
      taskCount: selected.reduce((sum, { point }) => sum + point.taskCount, 0),
    };
  });
};

/** Reweights candidate, trivial, and out-of-reach strata to the screened pool. */
export const reweightCostQuality = (
  strata: readonly {
    prevalence: number;
    points: readonly CostQualityPoint[];
  }[]
) => weighted(strata);

export const dominanceVerdict = (
  points: readonly CostQualityPoint[],
  qualityFraction = 0.9,
  flowArm: EvaluationArm = "E+A",
  frontierArm: EvaluationArm = "F"
): DominanceResult => {
  if (!(qualityFraction > 0 && qualityFraction <= 1)) {
    throw new RangeError(
      "Quality fraction must be greater than zero and at most one."
    );
  }
  const flow = points.find((point) => point.arm === flowArm);
  const frontier = points.find((point) => point.arm === frontierArm);
  if (!(flow && frontier)) {
    throw new Error("Dominance comparison requires flow and frontier points.");
  }
  if (
    flow.costPerTask === "unavailable" ||
    frontier.costPerTask === "unavailable"
  ) {
    return {
      flow,
      frontier,
      qualityFraction,
      status: "unavailable",
      verdict: "UNAVAILABLE",
    };
  }
  const dominated =
    flow.costPerTask >= frontier.costPerTask ||
    flow.passRate < qualityFraction * frontier.passRate;
  return {
    flow,
    frontier,
    qualityFraction,
    status: dominated ? "dominated" : "not-dominated",
    verdict: dominated ? "NOT_WORTH_IT" : "WORTH_CONSIDERING",
  };
};

export const breakEvenConsultations = (
  executorCost: CostValue,
  frontierCost: CostValue,
  advisorUnitCost: CostValue
): CostValue => {
  if (
    executorCost === "unavailable" ||
    frontierCost === "unavailable" ||
    advisorUnitCost === "unavailable" ||
    advisorUnitCost <= 0
  ) {
    return "unavailable";
  }
  return Math.max(0, (frontierCost - executorCost) / advisorUnitCost);
};

/** Compact SVG keeps both Q3 plots visible in archived Markdown reports. */
export const renderCostQualityPlot = (
  points: readonly CostQualityPoint[],
  title: string
) => {
  const width = 640;
  const height = 360;
  const drawableWidth = 520;
  const drawableHeight = 250;
  const numeric = points.filter(
    (point): point is CostQualityPoint & { costPerTask: number } =>
      point.costPerTask !== "unavailable"
  );
  const maxCost = Math.max(1, ...numeric.map((point) => point.costPerTask));
  const x = (cost: number) => 70 + (cost / maxCost) * drawableWidth;
  const y = (passRate: number) => 300 - passRate * drawableHeight;
  const marks = points
    .map((point) => {
      if (point.costPerTask === "unavailable") {
        return `<text x="70" y="${y(point.passRate)}" fill="#fca5a5">${point.arm}: unavailable</text>`;
      }
      return `<circle cx="${x(point.costPerTask)}" cy="${y(point.passRate)}" r="7" fill="#7dd3fc"><title>${point.arm}: $${point.costPerTask.toFixed(4)}, ${(point.passRate * 100).toFixed(1)}%</title></circle><text x="${x(point.costPerTask) + 10}" y="${y(point.passRate) + 5}" fill="#e2e8f0">${point.arm}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}"><rect width="100%" height="100%" fill="#0f172a"/><text x="20" y="30" fill="#f8fafc" font-family="sans-serif">${title}</text><line x1="70" y1="300" x2="590" y2="300" stroke="#64748b"/><line x1="70" y1="50" x2="70" y2="300" stroke="#64748b"/><text x="250" y="340" fill="#94a3b8" font-family="sans-serif">USD per task</text><text x="10" y="180" fill="#94a3b8" font-family="sans-serif" transform="rotate(-90 10 180)">pass rate</text>${marks}</svg>`;
};

export const evaluationArmNames: readonly ArmName[] = ["E", "E+A", "F", "F′"];

export const q2TaskPairs = pairedDiscordance;
