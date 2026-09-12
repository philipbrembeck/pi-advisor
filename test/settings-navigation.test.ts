import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { resetConfigCache } from "../src/config.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import {
  advisorMessageText,
  advisorSessionState,
  parseAutomaticDecision,
  registerAdvisorTool,
} from "../src/tools.ts";
import { AdvisorSettingsSelector } from "../src/ui.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { mockPi } from "./helpers/mock-pi.ts";
import { changeSetting, plainScreen } from "./helpers/settings-navigation.ts";

initTheme();

const SIMPLE_MODE_ON = /→ Simple mode\s+On/;
const SIMPLE_MODE_OFF = /→ Simple mode\s+Off/;

const selectorTheme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
} as any;

const openSelector = (initial: any) => {
  const saved: any[] = [];
  const selector = new AdvisorSettingsSelector({
    effortLevels: ["Default (Model Default)", "low", "high"],
    initial: {
      collapseResponses: false,
      completionGate: true,
      contextMaxChars: 15_000,
      effort: "Default (Model Default)",
      failureGate: true,
      planGate: true,
      ...initial,
    },
    onCancel: () => undefined,
    onChange: (value: any) => saved.push(value),
    presets: [
      { description: "none", label: "0", value: 0 },
      { description: "10k", label: "10k", value: 10_000 },
      { description: "15k", label: "15k", value: 15_000 },
    ],
    theme: selectorTheme,
    tui: { requestRender: () => undefined },
  } as any);
  return { saved, selector };
};

describe("Advisor settings navigation and gate parsing regressions", () => {
  test("steps every off-preset numeric setting from its configured value", () => {
    const { saved, selector } = openSelector({
      contextMaxChars: 12_000,
      gitContextMaxChars: 30_000,
      loopThreshold: 7,
      maxCallsPerSession: 7,
      toolResultMaxBytes: 75_000,
      toolResultMaxLines: 3000,
    });
    for (const row of [
      "Context window",
      "Loop threshold",
      "Max Advisor calls/session",
      "Tool result lines",
      "Tool result bytes",
      "Repository context chars",
    ]) {
      changeSetting(selector, row);
    }
    expect(saved.at(-1)).toMatchObject({
      contextMaxChars: 15_000,
      gitContextMaxChars: 50_000,
      loopThreshold: 8,
      maxCallsPerSession: 10,
      toolResultMaxBytes: 100 * 1024,
      toolResultMaxLines: 5000,
    });
  });

  test("cycles custom numeric values to the next available value", () => {
    const { saved, selector } = openSelector({
      contextMaxChars: 12_000,
      maxCallsPerSession: 7,
    });
    changeSetting(selector, "Context window");
    changeSetting(selector, "Max Advisor calls/session");
    expect(saved.at(-1)).toMatchObject({
      contextMaxChars: 15_000,
      maxCallsPerSession: 10,
    });
  });

  test("focuses the advanced Context slider and changes its value", () => {
    const { selector } = openSelector({
      contextMaxChars: 10_000,
      simpleMode: false,
    });
    const before = plainScreen(selector);
    expect(before).toContain("→ Context window");
    expect(before).toContain("10k");
    expect(before.match(/Context window/g)).toHaveLength(1);
    changeSetting(selector, "Context window");
    expect(plainScreen(selector)).toContain("15k");
  });

  test("filters advanced controls while Simple mode is enabled", () => {
    const { selector } = openSelector({
      contextMaxChars: 10_000,
      simpleMode: false,
    });
    changeSetting(selector, "Simple mode");
    expect(plainScreen(selector)).toMatch(SIMPLE_MODE_ON);
    expect(plainScreen(selector)).not.toContain("Plan gate");
    changeSetting(selector, "Simple mode");
    expect(plainScreen(selector)).toMatch(SIMPLE_MODE_OFF);
    expect(plainScreen(selector)).toContain("Plan gate");
  });

  test("keeps simple-mode settings visible after reopening", () => {
    const { selector } = openSelector({
      alwaysOn: false,
      simpleMode: true,
    });
    const screen = plainScreen(selector);
    expect(screen).toContain("Context window");
    expect(screen).toContain("Simple mode");
    expect(screen).toContain("Always on");
    expect(screen).not.toContain("Plan gate");
    selector.dispose();
  });

  test("treats a quoted decision inside a fenced example as illustrative", () => {
    const result = parseAutomaticDecision(
      "Decision: revise\n\nUse this format:\n\n```\nDecision: proceed\n```\n\nThen retry."
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision).toBe("revise");
    }
  });

  test("still rejects a real second decision outside a fenced example", () => {
    const result = parseAutomaticDecision(
      "Decision: revise\n\n```\nDecision: proceed\n```\n\nDecision: blocked"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.category).toBe("contradictory-decision");
    }
  });

  test("never sends an empty Advisor request body", () => {
    expect(advisorMessageText("", undefined).trim().length).toBeGreaterThan(0);
    expect(advisorMessageText("", "Focus")).toContain("Focus");
    expect(advisorMessageText("history", undefined)).toContain(
      "<conversation>"
    );
  });

  test("allows an outcome persistence failure to be retried", async () => {
    await withAgentDir({ advisorOutcomeLogging: true }, async (agentDir) => {
      const state = new AdvisorSessionState();
      const tools = new Map<string, any>();
      const outcomes: Promise<void>[] = [
        Promise.reject(new Error("disk full")),
        Promise.resolve(),
      ];
      const pi = mockPi({ tools });
      state.issueAdvice(
        "advice-1",
        "Review the migration.",
        "executor-requested"
      );
      registerAdvisorTool(pi, state, {
        appendOutcome: (() => outcomes.shift() ?? Promise.resolve()) as any,
      });
      const recordOutcome = tools.get("record_advisor_outcome");
      const params = {
        adoption: "followed",
        adviceId: "advice-1",
        validationStatus: "passed",
      };
      const run = (callId: string) =>
        recordOutcome.execute(callId, params, undefined, undefined, {
          cwd: agentDir,
          hasUI: false,
          isProjectTrusted: () => false,
        });
      const first = await run("outcome-1");
      expect(first.details).toEqual({ recorded: false });
      expect(state.reserveAdvice("advice-1")).toBeDefined();
      state.releaseAdvice("advice-1");

      const second = await run("outcome-2");
      expect(second.details).toEqual({ recorded: true });
      expect(state.reserveAdvice("advice-1")).toBeUndefined();

      await expect(run("outcome-3")).rejects.toThrow(
        "Unknown, already recorded, or pending adviceId."
      );
    });
  });

  test("keeps concurrent registrations' safety state isolated", () => {
    const firstState = new AdvisorSessionState();
    const secondState = new AdvisorSessionState();
    const firstStarts: Array<() => void> = [];
    const secondStarts: Array<() => void> = [];
    const makePi = (starts: Array<() => void>) =>
      mockPi(
        {},
        {
          getActiveTools: () => [],
          on(event: string, handler: any) {
            if (event === "session_start") {
              starts.push(handler);
            }
          },
          registerMessageRenderer: () => undefined,
          registerTool: () => undefined,
        }
      );

    registerAdvisorTool(makePi(firstStarts), firstState);
    registerAdvisorTool(makePi(secondStarts), secondState);
    firstStarts[0]();
    firstState.block("first session remains blocked");
    firstState.consumeCall();

    secondStarts[0]();

    expect(firstState.blockedReason).toBe("first session remains blocked");
    expect(firstState.consumedCalls).toBe(1);
    expect(secondState.blocked).toBe(false);
    expect(secondState.consumedCalls).toBe(0);
  });

  test("keeps a recorded session block active after ask_advisor is disabled", () => {
    let toolCall: any;
    const events = new Map<string, any>();
    registerAdvisorTool(
      mockPi({ events }, { events: { emit: () => undefined } })
    );
    toolCall = events.get("tool_call");
    advisorSessionState.resetTask();
    advisorSessionState.block("still blocked");
    try {
      expect(
        toolCall(
          { input: {}, toolCallId: "disabled", toolName: "read" },
          { hasUI: false }
        )
      ).toMatchObject({ block: true, reason: "still blocked" });
    } finally {
      advisorSessionState.clearBlocked();
    }
  });

  test("does not let project Simple mode clear a stale block", async () => {
    let toolCall: any;
    registerAdvisorTool(
      mockPi(
        {},
        {
          getActiveTools: () => ["ask_advisor"],
          on(event: string, handler: any) {
            if (event === "tool_call") {
              toolCall = handler;
            }
          },
          registerCommand: () => undefined,
          registerMessageRenderer: () => undefined,
          registerTool: () => undefined,
        }
      )
    );

    // loadConfig runs per tool call, so the mode must come from a real file.
    const projectDir = mkdtempSync(join(tmpdir(), "pi-advisor-project-"));
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    const configPath = join(projectDir, ".pi", "advisor.json");
    const ctx = {
      cwd: projectDir,
      hasUI: false,
      isProjectTrusted: () => true,
    } as any;

    try {
      writeFileSync(configPath, JSON.stringify({ simpleMode: false }));
      resetConfigCache();
      advisorSessionState.block("earlier gate failure");
      expect(
        toolCall({ input: {}, toolCallId: "1", toolName: "read" }, ctx)
      ).toMatchObject({ block: true });

      writeFileSync(configPath, JSON.stringify({ simpleMode: true }));
      resetConfigCache();
      expect(
        await toolCall({ input: {}, toolCallId: "2", toolName: "read" }, ctx)
      ).toMatchObject({ block: true, reason: "earlier gate failure" });
      expect(advisorSessionState.blocked).toBe(true);
    } finally {
      advisorSessionState.clearBlocked();
      resetConfigCache();
      rmSync(projectDir, { force: true, recursive: true });
    }
  });
});
