import type { DecisionItem } from "../types.ts";

/** Fixed control text: it names no target choice and makes no decision. */
export const NULL_ADVICE =
  "I do not have a specific finding from the supplied evidence. Keep the current direction and validate it normally.";

export const nullAdvice = (_item: DecisionItem) => NULL_ADVICE;
