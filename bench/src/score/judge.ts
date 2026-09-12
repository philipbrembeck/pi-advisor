import type { DecisionItem, ModelPin } from "../types.ts";

export interface JudgeRequest {
  advice: string;
  item: DecisionItem;
  pin: ModelPin;
}

export interface JudgeInvocation {
  effort: string;
  latencyMs: number;
  model: string;
  request?: Record<string, unknown>;
  text: string;
  usage?: unknown;
}

export type JudgeInvoker = (request: JudgeRequest) => Promise<JudgeInvocation>;

export interface ParsedJudge {
  justification: string;
  pass: boolean;
}

const FENCED_JSON_START = /^```(?:json)?\s*/i;
const FENCED_JSON_END = /\s*```$/i;

const jsonObject = (text: string): Record<string, unknown> | undefined => {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(FENCED_JSON_START, "")
    .replace(FENCED_JSON_END, "")
    .trim();
  try {
    const value: unknown = JSON.parse(withoutFence);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

export const parseJudgeResponse = (text: string): ParsedJudge => {
  const value = jsonObject(text);
  if (!value || typeof value.pass !== "boolean") {
    throw new TypeError(
      "Judge response must be a JSON object with boolean pass and string justification."
    );
  }
  if (typeof value.justification !== "string" || !value.justification.trim()) {
    throw new TypeError(
      "Judge response must include a non-empty justification."
    );
  }
  return {
    justification: value.justification.trim(),
    pass: value.pass,
  };
};

const answerKey = (item: DecisionItem) => ({
  defectClass: item.key.defectClass,
  findingId: item.key.findingId,
  reasonTokens: item.key.reasonTokens,
  targetFile: item.key.targetFile,
  targetSymbol: item.key.targetSymbol,
});

const traps = (item: DecisionItem) =>
  item.traps.map((trap) => ({ choice: trap.choice, tokens: trap.tokens }));

/** Narrow entailment prompts keep the judge from grading general writing quality. */
export const buildJudgePrompt = (item: DecisionItem, advice: string) => {
  if (item.polarity === "positive") {
    return [
      "Judge whether the Advisor identified the specific known defect in the supplied evidence.",
      "Pass only when the advice identifies the keyed defect and gives a materially correct reason; do not award credit for generic caution.",
      `Answer key: ${JSON.stringify(answerKey(item))}`,
      `Advisor text: ${advice}`,
      'Return only JSON: {"pass": boolean, "justification": "brief evidence-based reason"}.',
    ].join("\n\n");
  }
  return [
    "Judge whether the Advisor falsely flags a known-correct choice in the supplied draft.",
    "Pass when the advice does not tell the Executor to change, remove, or abandon any listed trap. Mentioning a choice while endorsing it is not a false alarm.",
    `Known-correct choices (traps): ${JSON.stringify(traps(item))}`,
    `Advisor text: ${advice}`,
    'Return only JSON: {"pass": boolean, "justification": "brief evidence-based reason"}.',
  ].join("\n\n");
};

export interface ScoredJudge {
  available: boolean;
  justification?: string;
  latencyMs?: number;
  pass: boolean | null;
  usage?: unknown;
}

export const judgeAdvice = async (
  item: DecisionItem,
  advice: string,
  pin: ModelPin,
  invoke: JudgeInvoker
): Promise<ScoredJudge> => {
  const invocation = await invoke({ advice, item, pin });
  const parsed = parseJudgeResponse(invocation.text);
  return {
    available: true,
    justification: parsed.justification,
    latencyMs: invocation.latencyMs,
    pass: parsed.pass,
    usage: invocation.usage,
  };
};

/** Adapts the deterministic control rubric to the same judge result shape. */
export const deterministicJudge = (
  pass: boolean,
  justification: string
): ScoredJudge => ({
  available: true,
  justification,
  latencyMs: 0,
  pass,
});
