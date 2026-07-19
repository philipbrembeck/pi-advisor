import { expect, test, describe } from "bun:test";
import { AdvisorSessionState } from "../src/session-state.js";

describe("AdvisorSessionState", () => {
  test("blocks the third equivalent tool action and resets for a new action", () => {
    const state = new AdvisorSessionState();
    expect(state.recordToolCall("bash", { command: "bun test", timeout: 30 }, 3)).toBe(false);
    expect(state.recordToolCall("bash", { timeout: 30, command: "bun test" }, 3)).toBe(false);
    expect(state.recordToolCall("bash", { command: "bun test", timeout: 30 }, 3)).toBe(true);
    state.resetRepetition();
    expect(state.recordToolCall("bash", { command: "bun test", timeout: 30 }, 3)).toBe(false);
    expect(state.recordToolCall("bash", { command: "bun run typecheck" }, 3)).toBe(false);
  });

  test("tracks a finite session-wide Advisor budget", () => {
    const state = new AdvisorSessionState();
    expect(state.remainingAutomaticCalls(2)).toBe(2);
    state.consumeAutomaticCall();
    expect(state.remainingAutomaticCalls(2)).toBe(1);
    state.consumeAutomaticCall();
    expect(state.canUseAutomaticCall(2)).toBe(false);
  });

  test("does not generate a summary without Advisor activity", () => {
    const state = new AdvisorSessionState();
    expect(state.summary(undefined)).toBeUndefined();
    state.recordConsultation("executor", "revise");
    expect(state.summary(3)).toContain("[Session Advisor Summary]");
  });
});
