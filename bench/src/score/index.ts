import type { ArmName, DecisionItem, DecisionScore } from "../types.ts";
import { type JudgeInvoker, judgeAdvice, type ScoredJudge } from "./judge.ts";
import { mechanicalScore } from "./mechanical.ts";

export interface ScoreAdviceOptions {
  advice: string;
  arm: ArmName;
  item: DecisionItem;
  judge?: JudgeInvoker;
  judgePin?: import("../types.js").ModelPin;
}

const noJudge = (justification: string): ScoredJudge => ({
  available: false,
  justification,
  pass: null,
});

/** Scores both tracks without allowing a missing judge to become a pass. */
export const scoreAdvice = async ({
  arm,
  item,
  judge,
  judgePin,
  advice,
}: ScoreAdviceOptions): Promise<DecisionScore> => {
  const mechanical = mechanicalScore(item, advice);
  let judged: ScoredJudge;
  if (item.polarity === "positive" && mechanical === false) {
    judged = noJudge("Mechanical location check failed; judge was not run.");
  } else if (judge && judgePin) {
    judged = await judgeAdvice(item, advice, judgePin, judge);
  } else {
    judged = noJudge("No judge invocation was configured.");
  }
  const judgePass = judged.pass === true;
  return {
    arm,
    caught: item.polarity === "positive" && judgePass,
    falseAlarm: item.polarity === "negative" && judged.pass === false,
    itemId: item.id,
    ...(judged.justification ? { justification: judged.justification } : {}),
    judge: judged.pass,
    judgeAvailable: judged.available,
    mechanical,
    ...(judged.latencyMs === undefined ? {} : { latencyMs: judged.latencyMs }),
    ...(judged.usage === undefined ? {} : { usage: judged.usage }),
  };
};

export const scoreRate = (
  scores: DecisionScore[],
  predicate: (score: DecisionScore) => boolean
) => {
  const selected = scores.filter(predicate);
  return selected.length
    ? selected.filter((score) => score.caught).length / selected.length
    : 0;
};

export const falseAlarmRate = (
  scores: DecisionScore[],
  predicate: (score: DecisionScore) => boolean
) => {
  const selected = scores.filter(predicate);
  return selected.length
    ? selected.filter((score) => score.falseAlarm).length / selected.length
    : 0;
};

export const mechanicalCatchRate = (
  scores: DecisionScore[],
  predicate: (score: DecisionScore) => boolean
) => {
  const selected = scores.filter(predicate);
  return selected.length
    ? selected.filter((score) => score.mechanical === true).length /
        selected.length
    : 0;
};
