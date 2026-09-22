import { describe, expect, test } from "bun:test";

import {
  AdvisorSessionState,
  normalizedToolSignature,
  normalizeToolInput,
} from "../src/session-state.ts";

describe("AdvisorSessionState", () => {
  test("blocks the third equivalent normalized tool action and resets for a new action", () => {
    const state = new AdvisorSessionState();
    expect(
      state.recordToolCall("bash", { command: "bun   test", timeout: 30 }, 3)
    ).toBe(false);
    expect(
      state.recordToolCall("bash", { command: " bun test ", timeout: 30 }, 3)
    ).toBe(false);
    expect(
      state.recordToolCall("bash", { command: "bun test", timeout: 30 }, 3)
    ).toBe(true);
    state.resetRepetition();
    expect(
      state.recordToolCall("bash", { command: "bun test", timeout: 30 }, 3)
    ).toBe(false);
    expect(
      state.recordToolCall("bash", { command: "bun run typecheck" }, 3)
    ).toBe(false);
  });

  test("removes only allowlisted volatile fields and preserves argument order", () => {
    expect(
      normalizeToolInput("http", {
        args: ["a", "b"],
        requestId: "abc",
        timestamp: "2026-01-01",
      })
    ).toEqual({
      args: ["a", "b"],
      requestId: "<request-id>",
      timestamp: "<timestamp>",
    });
    expect(normalizedToolSignature("tool", { args: ["a", "b"] })).not.toBe(
      normalizedToolSignature("tool", { args: ["b", "a"] })
    );
  });

  test("does not treat semantic keys containing date as timestamps", () => {
    expect(normalizeToolInput("tool", { update: "first" })).not.toEqual(
      normalizeToolInput("tool", { update: "second" })
    );
  });

  test("tracks a finite shared Advisor budget", () => {
    const state = new AdvisorSessionState();
    expect(state.remainingCalls(2)).toBe(2);
    state.consumeCall();
    expect(state.remainingCalls(2)).toBe(1);
    state.consumeCall();
    expect(state.canConsult(2)).toBe(false);
  });

  test("requires explicitly named paths for tracked file handoff", () => {
    const session = new AdvisorSessionState();
    expect(session.claimTrackedFiles(["review.md"])).toBe(false);
    session.issueAdvice(
      "id",
      "I need to inspect review.md",
      "executor-requested"
    );
    expect(session.claimTrackedFiles(["review.md"])).toBe(true);
    expect(session.claimTrackedFiles(["review.md"])).toBe(false);
    session.issueAdvice("id-2", "Review review.md.old", "executor-requested");
    expect(session.claimTrackedFiles(["review.md"])).toBe(false);
    expect(session.claimTrackedFiles(["other.md"])).toBe(false);
  });

  test("aggregates direct usage and resets it for a new session", () => {
    const state = new AdvisorSessionState();
    state.recordInvocation({
      executionEffect: "continued",
      kind: "markdown",
      model: "test/model",
      trigger: "executor-requested",
      usage: {
        cacheRead: 3,
        cost: { total: 0.01 },
        input: 100,
        output: 20,
      },
    });
    state.recordInvocation({
      executionEffect: "continued",
      kind: "gate",
      model: "test/model",
      trigger: "repeated-tool-call",
      usage: { totalCost: 0.02, totalTokens: 5 },
    });
    expect(state.usageStatus()).toContain("2 calls");
    expect(state.usageStatus()).toContain("$0.0300");
    expect(state.usageTotals).toMatchObject({
      calls: 2,
      cost: 0.03,
      input: 100,
      knownCalls: 2,
      output: 20,
      totalTokens: 5,
    });

    state.resetTask();
    expect(state.usageTotals).toEqual({
      calls: 0,
      costCalls: 0,
      knownCalls: 0,
    });
    expect(state.usageStatus()).toBeUndefined();
  });

  test("does not generate a summary without Advisor activity", () => {
    const state = new AdvisorSessionState();
    expect(state.summary(undefined)).toBeUndefined();
    state.recordInvocation({
      executionEffect: "continued",
      kind: "markdown",
      model: "test/model",
      trigger: "executor-requested",
    });
    state.recordInvocation({
      decision: "revise",
      executionEffect: "tool-blocked",
      kind: "gate",
      model: "test/model",
      trigger: "repeated-tool-call",
    });
    state.consumeCall();
    expect(state.summary(3)).toContain("[Session Advisor Summary]");
    expect(state.summary(3)).toContain("Markdown advice: 1 responses");
    expect(state.summary(3)).toContain("Gate decisions: 1 revise");
    expect(state.summary(3)).toContain("Budget: 1 / 3 used; 2 remaining");
    expect(state.summary(3)).toContain("normalized tool signatures");
  });
});

describe("Jev session state", () => {
  test("keeps the turn ordinal never-reset while turnsSinceConsultation resets", () => {
    const state = new AdvisorSessionState();
    state.recordCompletedTurn();
    state.recordCompletedTurn();
    state.resetTurnsSinceConsultation();
    state.recordCompletedTurn();
    expect(state.sessionTurnOrdinal).toBe(3);
    expect(state.turnsSinceConsultation).toBe(1);
  });

  test("tracks filter ledger counts, lastSkip, and overrides", () => {
    const state = new AdvisorSessionState();
    state.recordCompletedTurn();
    state.recordJevFilterAllowed();
    state.recordJevFilterSkipped(false, "ship it?");
    state.recordJevFilterSkipped(true, "ship it?");
    state.recordJevFilterOverride();
    state.recordJevFilterFailure();
    state.recordJevFilterUsage({
      cost: 0.001,
      inputTokens: 20_000,
      outputTokens: 100,
    });
    expect(state.lastJevSkip).toEqual({
      normalizedQuestion: "ship it?",
      turn: 1,
    });
    const summary = state.summary(undefined) ?? "";
    expect(summary).toContain(
      "Jev filter: 3 screened (1 allowed, 2 skipped [1 repeat]), 1 override, 1 failure"
    );
    expect(summary).toContain("Jev cost: ↑20k tokens · $0.0010");
  });

  test("estimates the saving from skips as an upper bound", () => {
    const state = new AdvisorSessionState();
    state.recordInvocation({
      cost: 0.04,
      executionEffect: "continued",
      kind: "markdown",
      model: "test/model",
      trigger: "executor-requested",
    });
    state.recordJevFilterSkipped(false, "a?");
    state.recordJevFilterSkipped(false, "b?");
    const summary = state.summary(undefined) ?? "";
    expect(summary).toContain("Estimated saving from skips: ≤ $0.0800");
    expect(summary).toContain("upper bound");
  });

  test("renders the saving line as unavailable before any observed consultation", () => {
    const state = new AdvisorSessionState();
    state.recordJevFilterSkipped(false, "a?");
    const summary = state.summary(undefined) ?? "";
    expect(summary).toContain("Estimated saving from skips: unavailable");
  });

  test("renders a filter-only session summary without consultations", () => {
    const state = new AdvisorSessionState();
    state.recordJevFilterSkipped(false, "a?");
    expect(state.summary(undefined)).toContain("[Session Advisor Summary]");
    state.resetTask();
    expect(state.summary(undefined)).toBeUndefined();
  });

  test("reattaches advice only for an exact normalized question", () => {
    const state = new AdvisorSessionState();
    state.issueAdvice(
      "id",
      "Earlier advice.",
      "executor-requested",
      false,
      "ship it?"
    );
    expect(state.reattachedAdviceFor("ship it?")).toBe("Earlier advice.");
    expect(state.reattachedAdviceFor("SHIP IT?")).toBeUndefined();
    expect(state.reattachedAdviceFor(undefined)).toBeUndefined();
  });

  test("labels a dedup-only line without claiming Jev activity", () => {
    const state = new AdvisorSessionState();
    state.recordJevFilterSkipped(true, "a?");
    state.recordJevFilterSkipped(true, "b?");
    const summary = state.summary(undefined) ?? "";
    expect(summary).toContain(
      "Consultation dedup: 2 repeat questions skipped, earlier advice reattached"
    );
    expect(summary).not.toContain("Jev filter:");
    expect(summary).toContain("Estimated saving from skips: unavailable");
  });

  test("renders the turn-gate line with separated spend", () => {
    const state = new AdvisorSessionState();
    state.recordJevGateCheck({
      cost: 0.0004,
      inputTokens: 9000,
      outputTokens: 0,
    });
    state.recordJevGateConsultation();
    state.recordInvocation({
      cost: 0.081,
      executionEffect: "continued",
      kind: "markdown",
      model: "test/model",
      trigger: "turn-gate",
    });
    const summary = state.summary(undefined) ?? "";
    expect(summary).toContain(
      "Turn gate: 1 check (Jev ↑9.0k · $0.0004), 1 consultation ($0.0810)"
    );
  });
});

describe("resetRepetition", () => {
  test("keeps cumulative gate interventions while clearing the signature", () => {
    const state = new AdvisorSessionState();
    expect(state.recordToolCall("bash", { command: "pwd" }, 2)).toBe(false);
    expect(state.recordToolCall("bash", { command: "pwd" }, 2)).toBe(true);
    state.resetRepetition();
    expect(state.recordToolCall("bash", { command: "pwd" }, 2)).toBe(false);
    expect(state.summary(undefined)).toContain("1 gate intervention");
  });
});
