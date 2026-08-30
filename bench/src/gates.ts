import type { GateDecision, GateFailureMode, ReplayCase } from "./types.js";

export const GATE_FAILURE_MODES: GateFailureMode[] = [
  "block-session",
  "block-tool",
  "warn-and-continue",
];

const DECISION_LINE = /^Decision\s*:\s*(proceed|revise|blocked)\s*$/i;
const CODE_FENCE = /^(?:```|~~~)/;
const LINE_BREAK = /\r?\n/;

export type GateFailureCategory =
  | "empty-response"
  | "missing-decision"
  | "malformed-decision"
  | "duplicate-decision"
  | "contradictory-decision";

export interface ParsedGate {
  decision?: GateDecision;
  failure?: GateFailureCategory;
  markdown: string;
}

export const parseGateResponse = (text: string): ParsedGate => {
  const lines = text.split(LINE_BREAK);
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstIndex < 0) {
    return { failure: "empty-response", markdown: text };
  }
  const first = lines[firstIndex].trim();
  const match = DECISION_LINE.exec(first);
  if (!match) {
    return {
      failure: first.toLowerCase().startsWith("decision:")
        ? "malformed-decision"
        : "missing-decision",
      markdown: text,
    };
  }
  const decision = match[1].toLowerCase() as GateDecision;
  let insideFence = false;
  const later: string[] = [];
  let fenced: string[] = [];
  for (const line of lines.slice(firstIndex + 1)) {
    const trimmed = line.trim();
    if (CODE_FENCE.test(trimmed)) {
      insideFence = !insideFence;
      if (!insideFence) {
        fenced = [];
      }
      continue;
    }
    const subsequent = DECISION_LINE.exec(trimmed);
    if (!subsequent) {
      continue;
    }
    const value = subsequent[1].toLowerCase() as GateDecision;
    if (insideFence) {
      fenced.push(value);
    } else {
      later.push(value);
    }
  }
  if (insideFence) {
    later.push(...fenced);
  }
  if (later.length > 0) {
    return {
      failure:
        later[0] === decision ? "duplicate-decision" : "contradictory-decision",
      markdown: text,
    };
  }
  return { decision, markdown: text };
};

export const replayCaseFor = (text: string): ReplayCase => {
  const parsed = parseGateResponse(text);
  if (parsed.decision) {
    return parsed.decision;
  }
  switch (parsed.failure) {
    case "duplicate-decision":
      return "duplicated";
    case "contradictory-decision":
      return "contradictory";
    default:
      return "malformed";
  }
};

export type GateEffect = "continued" | "tool-blocked" | "session-blocked";

export const failureEffect = (mode: GateFailureMode): GateEffect => {
  if (mode === "warn-and-continue") {
    return "continued";
  }
  if (mode === "block-tool") {
    return "tool-blocked";
  }
  return "session-blocked";
};

export const decisionEffect = (
  decision: GateDecision,
  mode: GateFailureMode
): GateEffect => {
  if (decision === "proceed") {
    return "continued";
  }
  if (decision === "blocked") {
    return failureEffect(mode);
  }
  return "tool-blocked";
};
