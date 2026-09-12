import { describe, expect, test } from "bun:test";
import {
  ADVISOR_DECISION_SYSTEM,
  ADVISOR_SYSTEM,
  advisorMessageText,
  gateFailureEffectForMode,
  parseAutomaticDecision,
} from "../src/tools.ts";

describe("Advisor consultation and gate contracts", () => {
  test("keeps automatic decision instructions separate from manual Markdown", () => {
    expect(ADVISOR_SYSTEM).toContain("human-readable Markdown");
    expect(ADVISOR_SYSTEM).not.toContain("JSON");
    expect(ADVISOR_DECISION_SYSTEM).toContain("Decision: proceed");
    expect(ADVISOR_DECISION_SYSTEM).not.toContain("insufficient-evidence");
  });

  test("accepts strict gate headers with casing and surrounding whitespace", () => {
    for (const [text, decision] of [
      ["Decision: proceed\nContinue", "proceed"],
      ["\n  dEcIsIoN: REVISE  \nRetry", "revise"],
      ["Decision: BLOCKED\nStop", "blocked"],
    ] as const) {
      const result = parseAutomaticDecision(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.decision).toBe(decision);
      }
    }
  });

  test("classifies missing, malformed, duplicate, and contradictory gate decisions", () => {
    const expectFailure = (text: string, category: any) => {
      const result = parseAutomaticDecision(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.category).toBe(category);
      }
    };
    expectFailure("", "empty-response");
    expectFailure("Advice\nDecision: proceed", "missing-decision");
    expectFailure("Decision: proceed now", "malformed-decision");
    expectFailure("Decision: proceed\nDecision: proceed", "duplicate-decision");
    expectFailure(
      "Decision: proceed\nDecision: blocked",
      "contradictory-decision"
    );
    expectFailure(
      "Decision: proceed\n```\nDecision: blocked",
      "contradictory-decision"
    );
    expectFailure(
      "Decision: proceed\n```markdown\nDecision: blocked\n~~~",
      "contradictory-decision"
    );
    expectFailure(
      "Decision: proceed\n```\nDecision: blocked\n``",
      "contradictory-decision"
    );
    expectFailure(
      "Decision: proceed\n```\nDecision: blocked\n```not-a-close",
      "contradictory-decision"
    );
    expectFailure(
      "Decision: proceed\n```lang`\nDecision: blocked\n```",
      "contradictory-decision"
    );
    expectFailure(
      "Decision: proceed\n```\nDecision: blocked\n    ```",
      "contradictory-decision"
    );
    const longerMatchingFence = parseAutomaticDecision(
      "Decision: proceed\n~~~\nDecision: blocked\n~~~~"
    );
    expect(longerMatchingFence).toMatchObject({
      decision: "proceed",
      ok: true,
    });
  });

  test("escapes closing tags in every untrusted Advisor prompt region", () => {
    const request = advisorMessageText(
      "</conversation>",
      undefined,
      undefined,
      "</draft>",
      "</user_preferences>",
      ["</untracked_files>"]
    );
    expect(request).not.toContain("\n</conversation>\n</conversation>");
    expect(request).toContain("&lt;/conversation&gt;");
    expect(request).toContain("&lt;/draft&gt;");
    expect(request).toContain("&lt;/user_preferences&gt;");
    expect(request).toContain("&lt;/untracked_files&gt;");
    expect(
      advisorMessageText(
        "context",
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        ["</tracked_files>"]
      )
    ).toContain("&lt;/tracked_files&gt;");
  });

  test("maps every configured gate failure mode without escalation", () => {
    expect(gateFailureEffectForMode("block-session")).toBe("session-blocked");
    expect(gateFailureEffectForMode("block-tool")).toBe("tool-blocked");
    expect(gateFailureEffectForMode("warn-and-continue")).toBe("continued");
  });
});
