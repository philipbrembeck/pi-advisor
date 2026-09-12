import type { DecisionItem } from "../types.ts";

export const oracleAdvice = (item: DecisionItem) => {
  if (item.polarity === "negative") {
    return "Decision: proceed\nThe proposed direction preserves the known-correct choices; do not change the listed traps.";
  }
  const { key } = item;
  return [
    "Decision: revise",
    `The defect is ${key.defectClass} in ${key.targetFile}, symbol ${key.targetSymbol}.`,
    `The review should address ${key.reasonTokens.join(", ")}.`,
  ].join("\n");
};
