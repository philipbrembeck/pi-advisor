import type { Questions } from "@typesafe-ai/sdk";

/** Exact rubric text for the stakes Score question; level 0 is the skip level. */
export const STAKES_RUBRIC = [
  "Negligible: routine, low-risk, mechanical, or reversible; a wrong call costs little and is easy to undo.",
  "Moderate: some risk or rework, but bounded and recoverable.",
  "High: material consequences for correctness, security, cost, user trust, or irreversibility.",
] as const;

const EVIDENCE_RULE =
  "Judge from `executor_question` and `executor_draft` when present, otherwise from `recent_conversation`; when both are absent, `recent_conversation` is the evidence to judge from.";

export const screeningQuestions: Questions = {
  self_answerable: {
    criteria: {
      false: "The executor needs the Advisor's second opinion.",
      true: "The executor can resolve this alone with available tools and context.",
    },
    instructions: `Can the executor confidently resolve this request alone, using available tools and context? ${EVIDENCE_RULE}`,
    type: "noul",
  },
  stakes: {
    criteria: [...STAKES_RUBRIC],
    instructions: `How material are the stakes of the decision behind this consultation request? ${EVIDENCE_RULE}`,
    type: "score",
  },
};

export interface TurnGateQuestions {
  instructions: string;
}

export interface ScreeningCriteria {
  noulMargin: number;
  skipConfidence: number;
}

export type ScreeningVerdict = { skip: false } | { skip: true };

const NUMERIC_KEY_PATTERN = /^\d+$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/**
 * Probability mass on the lowest stakes level, resolved through the answer's
 * legend (the key whose description equals level 0), falling back to the
 * smallest numeric index key only when no legend resolves. Shape-independent:
 * never hardcodes a level key and never uses `ceil(score)`.
 */
export const lowestStakesProbability = (
  answer: unknown
): number | undefined => {
  if (!isRecord(answer)) {
    return undefined;
  }
  const probabilities = isRecord(answer.probabilities)
    ? answer.probabilities
    : {};
  const legend = isRecord(answer.legend) ? answer.legend : undefined;
  if (legend) {
    const exact = Object.keys(legend).find(
      (key) => legend[key] === STAKES_RUBRIC[0]
    );
    if (exact) {
      return finiteNumber(probabilities[exact]);
    }
  }
  const numericKeys = Object.keys(probabilities).filter((key) =>
    NUMERIC_KEY_PATTERN.test(key)
  );
  if (numericKeys.length === 0) {
    return undefined;
  }
  const lowest = numericKeys.reduce((left, right) =>
    Number(left) <= Number(right) ? left : right
  );
  return finiteNumber(probabilities[lowest]);
};

const selfAnswerableNoul = (answer: unknown): number | undefined =>
  isRecord(answer) ? finiteNumber(answer.noul) : undefined;

/** Pure composition: skip requires the hard conjunction of confident
 * negligible stakes AND confident self-answerability. Any missing, NaN, or
 * malformed input allows. Never a weighted sum. */
export const composeScreeningVerdict = (
  answers: unknown,
  { noulMargin, skipConfidence }: ScreeningCriteria
): ScreeningVerdict => {
  if (!isRecord(answers)) {
    return { skip: false };
  }
  const negligibleMass = lowestStakesProbability(answers.stakes);
  const noul = selfAnswerableNoul(answers.self_answerable);
  if (negligibleMass === undefined || noul === undefined) {
    return { skip: false };
  }
  const confidentlySelfAnswerable = noul >= 0.5 + noulMargin;
  return {
    skip: negligibleMass >= skipConfidence && confidentlySelfAnswerable,
  };
};

/** Confident-true only; any uncertainty means no invocation. */
export const composeTurnGateVerdict = (
  answers: unknown,
  threshold: number
): boolean => {
  if (!isRecord(answers)) {
    return false;
  }
  const answer = answers.should_consult;
  const noul = isRecord(answer) ? finiteNumber(answer.noul) : undefined;
  return noul !== undefined && noul >= threshold;
};
