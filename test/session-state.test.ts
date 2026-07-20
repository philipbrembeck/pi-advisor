import { describe, expect, test } from "bun:test";
import {
  AdvisorSessionState,
  normalizedToolSignature,
  normalizeToolInput,
} from "../src/session-state.js";

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
