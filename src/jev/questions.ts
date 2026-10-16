import type { ClassifierQuestion } from "@earendil-works/pi-ai";
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

export const nativeTurnGateQuestion: ClassifierQuestion = {
  criteria: {
    false:
      "The executor is progressing soundly on work that matches the user's intent; interrupting would add nothing material.",
    true: "The executor is approaching a material decision, repeating a failure, about to claim success without validation, or drifting from the user's intent; a second opinion now would change what happens next.",
  },
  instructions:
    "Should a senior engineering advisor be consulted right now, before the executor continues? Judge from `recent_conversation`.",
  type: "bool",
};

export const nativeScreeningQuestions = {
  self_answerable: {
    criteria: {
      false: "The executor needs the Advisor's second opinion.",
      true: "The executor can resolve this alone with available tools and context.",
    },
    instructions: `Can the executor confidently resolve this request alone, using available tools and context? ${EVIDENCE_RULE}`,
    type: "bool",
  },
  stakes: {
    criteria: {
      high: STAKES_RUBRIC[2],
      moderate: STAKES_RUBRIC[1],
      negligible: STAKES_RUBRIC[0],
    },
    instructions: `How material are the stakes of the decision behind this consultation request? ${EVIDENCE_RULE}`,
    type: "choice",
  },
} satisfies Record<string, ClassifierQuestion>;

export interface TurnGateQuestions {
  instructions: string;
}

export interface ScreeningCriteria {
  noulMargin: number;
  skipConfidence: number;
}

export type ScreeningVerdict = { skip: false } | { skip: true };

const NUMERIC_KEY_PATTERN = /^\d+$/u;

const finiteProbability = (value: JsonValue | undefined): number | undefined =>
  isNumber(value) && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;

/** Lowest-stakes probability via rubric legend or the canonical native choice label. */
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
      return finiteProbability(probabilities[exact]);
    }
  }

  if (Object.hasOwn(probabilities, "negligible")) {
    return finiteProbability(probabilities.negligible);
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

  return finiteProbability(probabilities[lowest]);
};

const selfAnswerableProbability = <Answer>(
  answer: Answer
): number | undefined => {
  if (!isRecordOf(answer)) {
    return undefined;
  }

  const value = answer.type === "bool" ? answer.probability : answer.noul;

  return finiteProbability(value);
};

/** Pure composition; any missing, out-of-range, NaN, or malformed input allows. */
export const composeScreeningVerdict = <Answers>(
  answers: Answers,
  { noulMargin, skipConfidence }: ScreeningCriteria
): ScreeningVerdict => {
  if (!isRecordOf(answers)) {
    return { skip: false };
  }

  const negligibleMass = lowestStakesProbability(answers.stakes);
  const selfAnswerable = selfAnswerableProbability(answers.self_answerable);

  if (negligibleMass === undefined || selfAnswerable === undefined) {
    return { skip: false };
  }

  return {
    skip:
      negligibleMass >= skipConfidence && selfAnswerable >= 0.5 + noulMargin,
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

  const probability = selfAnswerableProbability(answers.should_consult);

  return probability !== undefined && probability >= threshold;
};
