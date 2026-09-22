import type { Questions } from "@typesafe-ai/sdk";

import { isNumber, isRecordOf } from "../content-utils.ts";
import type { JsonValue } from "../content-utils.ts";

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

const finiteNumber = (value: JsonValue | undefined): number | undefined =>
  isNumber(value) && Number.isFinite(value) ? value : undefined;

/**
 * Probability mass on the lowest stakes level, resolved through the answer's
 * legend (the key whose description equals level 0), falling back to the
 * smallest numeric index key only when no legend resolves. Shape-independent:
 * never hardcodes a level key and never uses `ceil(score)`.
 */
export const lowestStakesProbability = <Answer>(
  answer: Answer
): number | undefined => {
  if (!isRecordOf(answer)) {
    return undefined;
  }
  const probabilities = isRecordOf(answer.probabilities)
    ? answer.probabilities
    : {};
  const legend = isRecordOf(answer.legend) ? answer.legend : undefined;
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
  let [lowest] = numericKeys;
  for (const key of numericKeys) {
    if (Number(key) < Number(lowest)) {
      lowest = key;
    }
  }
  return finiteNumber(probabilities[lowest]);
};

const selfAnswerableNoul = <Answer>(answer: Answer): number | undefined =>
  isRecordOf(answer) ? finiteNumber(answer.noul) : undefined;

/** Pure composition: skip requires the hard conjunction of confident
 * negligible stakes AND confident self-answerability. Any missing, NaN, or
 * malformed input allows. Never a weighted sum. */
export const composeScreeningVerdict = <Answers>(
  answers: Answers,
  { noulMargin, skipConfidence }: ScreeningCriteria
): ScreeningVerdict => {
  if (!isRecordOf(answers)) {
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
export const composeTurnGateVerdict = <Answers>(
  answers: Answers,
  threshold: number
): boolean => {
  if (!isRecordOf(answers)) {
    return false;
  }
  const answer = answers.should_consult;
  const noul = isRecordOf(answer) ? finiteNumber(answer.noul) : undefined;
  return noul !== undefined && noul >= threshold;
};
