import type { DecisionItem } from "../types.js";

const includesToken = (text: string, token: string) =>
  text.toLocaleLowerCase().includes(token.toLocaleLowerCase());

/**
 * The mechanical track is deliberately conservative: it is defined only for
 * positive items and requires both answer-key location tokens.
 */
export const mechanicalPositiveCatch = (
  item: DecisionItem,
  advice: string
): boolean =>
  item.polarity === "positive" &&
  includesToken(advice, item.key.targetFile) &&
  includesToken(advice, item.key.targetSymbol);

export const mechanicalScore = (
  item: DecisionItem,
  advice: string
): boolean | null =>
  item.polarity === "positive" ? mechanicalPositiveCatch(item, advice) : null;
