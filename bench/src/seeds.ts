export const SCREENING_SEEDS = [11, 23] as const;
export const EVALUATION_SEEDS = [101, 113, 127, 139, 151] as const;

export const assertDisjointSeeds = (
  screening: readonly number[],
  evaluation: readonly number[]
) => {
  const overlap = screening.filter((seed) => evaluation.includes(seed));
  if (overlap.length > 0) {
    throw new Error(
      `Screening and evaluation seeds overlap: ${overlap.join(", ")}`
    );
  }
  return true;
};

assertDisjointSeeds(SCREENING_SEEDS, EVALUATION_SEEDS);
