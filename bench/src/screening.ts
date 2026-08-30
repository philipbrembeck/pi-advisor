import { assertDisjointSeeds } from "./seeds.js";
import type { BandScreenResult, CandidateBand } from "./types.js";

export interface ScreeningTaskResult {
  executorPasses: boolean[];
  frontierPasses: boolean[];
  taskId: string;
}

const anyPass = (values: readonly boolean[]) => values.some((value) => value);

/** Applies the preregistered two-seed proxy without looking at later E+A data. */
export const classifyCandidateBand = (
  executorPasses: readonly boolean[],
  frontierPasses: readonly boolean[]
): CandidateBand => {
  if (executorPasses.length !== 2 || frontierPasses.length !== 2) {
    throw new RangeError(
      "Band classification requires exactly two screening seeds per arm."
    );
  }
  if (anyPass(executorPasses)) {
    return "trivial";
  }
  if (anyPass(frontierPasses)) {
    return "candidate-uplift";
  }
  return "out-of-reach";
};

export const classifyScreeningTask = (
  result: ScreeningTaskResult
): BandScreenResult => ({
  candidateBand: classifyCandidateBand(
    result.executorPasses,
    result.frontierPasses
  ),
  executorPasses: [...result.executorPasses],
  frontierPasses: [...result.frontierPasses],
  taskId: result.taskId,
});

export const classifyScreeningPool = (
  results: readonly ScreeningTaskResult[]
): BandScreenResult[] => {
  const ids = new Set<string>();
  const classified = results.map((result) => {
    if (ids.has(result.taskId)) {
      throw new Error(`Duplicate screening task: ${result.taskId}`);
    }
    ids.add(result.taskId);
    return classifyScreeningTask(result);
  });
  return classified.sort((left, right) =>
    left.taskId.localeCompare(right.taskId)
  );
};

export const candidateBandPrevalence = (
  results: readonly BandScreenResult[]
) => {
  if (results.length === 0) {
    return 0;
  }
  return (
    results.filter((result) => result.candidateBand === "candidate-uplift")
      .length / results.length
  );
};

/** Deterministic seeded sampler used for the trivial-band Stage 2 stratum. */
export const selectTrivialStratum = (
  results: readonly BandScreenResult[],
  count: number,
  seed: number
) => {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError("Trivial stratum size must be a non-negative integer.");
  }
  const trivial = results.filter(
    (result) => result.candidateBand === "trivial"
  );
  if (count > trivial.length) {
    throw new RangeError(
      `Requested ${count} trivial tasks, only ${trivial.length} are available.`
    );
  }
  const orderFor = (taskId: string) => {
    let value = (seed + 1) % 2_147_483_647;
    for (const character of taskId) {
      value = (value * 31 + (character.codePointAt(0) ?? 0)) % 2_147_483_647;
    }
    return value;
  };
  return [...trivial]
    .sort((left, right) => left.taskId.localeCompare(right.taskId))
    .map((result) => ({ order: orderFor(result.taskId), result }))
    .sort((left, right) => left.order - right.order)
    .slice(0, count)
    .map(({ result }) => result)
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
};

export const classifyBand = classifyCandidateBand;

export const validateEvaluationSeeds = (
  screeningSeeds: readonly number[],
  evaluationSeeds: readonly number[]
) => {
  assertDisjointSeeds(screeningSeeds, evaluationSeeds);
  if (evaluationSeeds.length !== 5) {
    throw new RangeError("Stage 2 requires exactly five evaluation seeds.");
  }
  return true;
};
