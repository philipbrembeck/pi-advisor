import type { GateDecision } from "../session-state.js";
import type { AdvisorGateFailure, AdvisorGateResult } from "./types.js";

const DECISION_LINE = /^Decision\s*:\s*(proceed|revise|blocked)\s*$/i;
const CODE_FENCE = /^(?:```|~~~)/;
const LINE_BREAK = /\r?\n/;

export const parseAutomaticDecision = (
  text: string
): AdvisorGateResult | AdvisorGateFailure => {
  const lines = text.split(LINE_BREAK);
  const nonEmpty = lines.findIndex((line) => line.trim().length > 0);
  if (nonEmpty === -1) {
    return {
      category: "empty-response",
      message: "Advisor returned an empty gate response.",
      ok: false,
    };
  }
  const first = lines[nonEmpty].trim();
  const match = DECISION_LINE.exec(first);
  if (!match) {
    return {
      category: first.toLowerCase().startsWith("decision:")
        ? "malformed-decision"
        : "missing-decision",
      markdown: text,
      message:
        "Advisor gate response must begin with Decision: proceed, Decision: revise, or Decision: blocked.",
      ok: false,
    };
  }
  const decision = match[1].toLowerCase() as GateDecision;
  let insideFence = false;
  const decisions: string[] = [];
  let pendingFencedDecisions: string[] = [];
  for (const line of lines.slice(nonEmpty + 1)) {
    const trimmed = line.trim();
    // Decisions in a balanced fenced example are illustrative. If the fence is
    // malformed and never closes, retain its decisions so malformed Markdown
    // cannot hide a blocked verdict and make the gate fail open.
    if (CODE_FENCE.test(trimmed)) {
      insideFence = !insideFence;
      if (!insideFence) {
        pendingFencedDecisions = [];
      }
      continue;
    }
    const subsequent = DECISION_LINE.exec(trimmed);
    if (!subsequent) {
      continue;
    }
    const repeated = subsequent[1].trim().toLowerCase();
    if (insideFence) {
      pendingFencedDecisions.push(repeated);
    } else {
      decisions.push(repeated);
    }
  }
  if (insideFence) {
    decisions.push(...pendingFencedDecisions);
  }
  for (const repeated of decisions) {
    if (repeated === decision) {
      return {
        category: "duplicate-decision",
        markdown: text,
        message: "Advisor gate response contains duplicate decision lines.",
        ok: false,
      };
    }
    return {
      category: "contradictory-decision",
      markdown: text,
      message: "Advisor gate response contains contradictory decision lines.",
      ok: false,
    };
  }
  return {
    decision,
    markdown: text,
    model: "",
    ok: true,
    thinkingText: "",
    trigger: "repeated-tool-call",
  };
};

export const adviceForGateText = (result: AdvisorGateResult) =>
  `**Decision: ${result.decision}**\n\n${result.markdown}`;
