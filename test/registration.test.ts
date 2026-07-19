import { expect, test, describe } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import registerExtension from "../extensions/index.js";
import { registerCommands } from "../src/commands.js";
import { ADVISOR_DECISION_SYSTEM, ADVISOR_SYSTEM, adviceForDisplay, advisorMessageText, parseAdvice, parseAutomaticDecision, resolveAdvisorRequest } from "../src/tools.js";
import { setAdvisorCollapseResponsesRef } from "../src/config.js";
import { HerdrAdvisorActivity } from "../src/herdr.js";
import { AdvisorSettingsSelector } from "../src/ui.js";
import { initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

initTheme();

describe("Herdr Advisor activity", () => {
  test("keeps seeking advice visible until overlapping consultations finish", () => {
    const reports: any[] = [];
    const activity = new HerdrAdvisorActivity((request) => reports.push(request));

    activity.start();
    activity.start();
    activity.finish();
    expect(reports).toHaveLength(1);
    expect(reports[0].params).toMatchObject({
      state_labels: { working: "seeking advice" },
      agent: "pi",
      applies_to_source: "herdr:pi",
    });

    activity.finish();
    expect(reports).toHaveLength(2);
    expect(reports[1].params).toMatchObject({ clear_state_labels: true });
  });

  test("clears seeking advice on shutdown", () => {
    const reports: any[] = [];
    const activity = new HerdrAdvisorActivity((request) => reports.push(request));

    activity.start();
    activity.clear();
    activity.clear();

    expect(reports).toHaveLength(2);
    expect(reports[1].params).toMatchObject({ clear_state_labels: true });
  });

  test("does not let unavailable Herdr reporting interrupt advice", () => {
    const activity = new HerdrAdvisorActivity(() => { throw new Error("socket unavailable"); });

    expect(() => activity.start()).not.toThrow();
    expect(() => activity.finish()).not.toThrow();
  });
});

describe("Structured Advisor advice", () => {
  test("keeps automatic decision instructions separate from manual Markdown", () => {
    expect(ADVISOR_SYSTEM).toContain("human-readable Markdown");
    expect(ADVISOR_DECISION_SYSTEM).toContain("Decision: proceed");
    expect(ADVISOR_DECISION_SYSTEM).not.toContain("Return only a valid JSON object");
  });

  test("accepts valid automatic decisions and rejects malformed ones", () => {
    expect(parseAdvice(JSON.stringify({ verdict: "proceed", criticalFindings: [], missingEvidence: [], smallestNextStep: "Continue", verificationRequired: [], escalationReason: null })).verdict).toBe("proceed");
    expect(parseAdvice(JSON.stringify({ verdict: "revise", criticalFindings: [null], missingEvidence: [], smallestNextStep: "Retry", verificationRequired: [] })).verdict).toBe("insufficient-evidence");
    expect(parseAdvice(JSON.stringify({ verdict: "proceed", criticalFindings: [], missingEvidence: [1], smallestNextStep: "Continue", verificationRequired: [] })).verdict).toBe("insufficient-evidence");
    expect(parseAutomaticDecision("Decision: proceed\nMore guidance").verdict).toBe("proceed");
    expect(parseAutomaticDecision("\nDecision: proceed").verdict).toBe("insufficient-evidence");
    expect(parseAutomaticDecision("Advice\nDecision: proceed").verdict).toBe("insufficient-evidence");
    expect(parseAutomaticDecision("Decision: proceed now").verdict).toBe("insufficient-evidence");
  });
});

describe("Extension Registration", () => {
  test("should register advisor tool and commands correctly", () => {
    const registeredTools: string[] = [];
    const registeredCommands: string[] = [];

    const mockPi = {
      registerTool(tool: any) {
        registeredTools.push(tool.name);
      },
      registerCommand(name: string, _config: any) {
        registeredCommands.push(name);
      },
      on() {},
      getActiveTools() {
        return [];
      }
    } as unknown as ExtensionAPI;

    registerExtension(mockPi);

    // Verify tool registered
    expect(registeredTools).toContain("ask_advisor");

    // Verify all commands registered
    expect(registeredCommands).toContain("advisor");
    expect(registeredCommands).toContain("advisor-manual");
    expect(registeredCommands).toContain("advisor-models");
    expect(registeredCommands).toContain("advisor-settings");
    expect(registeredCommands).toContain("advisor-off");
  });

  test("fans a manual Advisor response out to the Executor without waiting for the command", async () => {
    const commands = new Map<string, any>();
    const sent: Array<{ message: any; options: any }> = [];
    let receivedQuestion: string | undefined;
    const mockPi = {
      registerCommand(name: string, config: any) { commands.set(name, config); },
      on() {},
      getActiveTools() { return []; },
      sendMessage(message: any, options: any) { sent.push({ message, options }); },
    } as unknown as ExtensionAPI;

    registerCommands(mockPi, {
      consult: async (_ctx, question) => {
        receivedQuestion = question;
        return { advice: "Ship the focused fix.", thinkingText: "" };
      },
    });

    await commands.get("advisor-manual").handler("Check the migration", { hasUI: false, isProjectTrusted: () => false, cwd: tmpdir() });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(receivedQuestion).toBe("Check the migration");
    expect(sent).toEqual([{
      message: expect.objectContaining({
        customType: "advisor-manual-result",
        content: expect.stringContaining("Ship the focused fix."),
        details: expect.objectContaining({ question: "Check the migration", text: "Ship the focused fix." }),
      }),
      options: { deliverAs: "steer", triggerTurn: true },
    }]);
  });

  test("adds an immediate Advisor call entry to the transcript", async () => {
    const commands = new Map<string, any>();
    const entries: Array<{ type: string; data: unknown }> = [];
    const mockPi = {
      registerCommand(name: string, config: any) { commands.set(name, config); },
      on() {},
      getActiveTools() { return []; },
      appendEntry(type: string, data: unknown) { entries.push({ type, data }); },
      sendMessage() {},
    } as unknown as ExtensionAPI;
    registerCommands(mockPi, { consult: async () => new Promise(() => {}) });

    await commands.get("advisor-manual").handler("Check the migration", { hasUI: false, isProjectTrusted: () => false, cwd: tmpdir() });

    expect(entries).toEqual([{ type: "advisor-manual-call", data: { question: "Check the migration" } }]);
  });

  test("cancels a manual consultation before its late response can fan out", async () => {
    const commands = new Map<string, any>();
    const events = new Map<string, () => void>();
    const sent: unknown[] = [];
    let resolveConsult!: (value: { advice: string; thinkingText: string }) => void;
    const pendingConsult = new Promise<{ advice: string; thinkingText: string }>((resolve) => { resolveConsult = resolve; });
    const mockPi = {
      registerCommand(name: string, config: any) { commands.set(name, config); },
      on(event: string, handler: () => void) { events.set(event, handler); },
      getActiveTools() { return []; },
      sendMessage(message: unknown) { sent.push(message); },
    } as unknown as ExtensionAPI;

    registerCommands(mockPi, { consult: async () => pendingConsult });
    await commands.get("advisor-manual").handler("", { hasUI: false, isProjectTrusted: () => false, cwd: tmpdir() });
    expect(sent).toEqual([]);

    events.get("session_shutdown")?.();
    resolveConsult({ advice: "Too late.", thinkingText: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual([]);
  });

  test("replaces an in-flight manual consultation with a newer request", async () => {
    const commands = new Map<string, any>();
    const signals: AbortSignal[] = [];
    const mockPi = {
      registerCommand(name: string, config: any) { commands.set(name, config); },
      on() {},
      getActiveTools() { return []; },
      sendMessage() {},
    } as unknown as ExtensionAPI;
    registerCommands(mockPi, {
      consult: async (_ctx, _question, signal) => {
        signals.push(signal!);
        return await new Promise<{ advice: string; thinkingText: string }>(() => {});
      },
    });

    await commands.get("advisor-manual").handler("First", { hasUI: false, isProjectTrusted: () => false, cwd: tmpdir() });
    await commands.get("advisor-manual").handler("Second", { hasUI: false, isProjectTrusted: () => false, cwd: tmpdir() });

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  test("distinguishes the executor request from the advisor response", () => {
    let advisorTool: any;
    const mockPi = {
      registerTool(tool: any) {
        if (tool.name === "ask_advisor") advisorTool = tool;
      },
      registerCommand() {},
      on() {},
      getActiveTools() {
        return [];
      },
    } as unknown as ExtensionAPI;
    registerExtension(mockPi);

    expect(advisorTool.parameters.required).toBeUndefined();

    const theme = {
      fg: (_color: string, text: string) => text,
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };
    const context = { lastComponent: undefined, state: {}, invalidate() {} };
    const request = advisorTool.renderCall({ question: "Should we ship this change?" }, theme, context)
      .render(120).join("\n");
    const response = advisorTool.renderResult({
      content: [{ type: "text", text: "Advisor (test/model)\n\n**Ship it.**" }],
      details: { advisor: "test/model", text: "**Ship it.**" },
    }, { isPartial: false }, theme, context).render(120).join("\n");

    expect(request).toContain("[advisor] Executor → Advisor");
    expect(request).toContain("Should we ship this change?");
    expect(request).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    expect(response).toContain("ADVISOR RESPONSE");
    expect(response).toContain("test/model");
    expect(response).toContain("Ship it.");
    expect(response).not.toContain("**Ship it.**");
    expect(response).not.toContain("Advisor (test/model)");

    const markdownPartial = advisorTool.renderResult({
      content: [{ type: "text", text: "The migration looks safe so far" }],
      details: { text: "The migration looks safe so far" },
    }, { isPartial: true }, theme, context).render(120).join("\n");
    expect(markdownPartial).toContain("The migration looks safe so far");
    expect(markdownPartial).not.toContain("criticalFindings");
  });

  test("advertises and uses a general contextual request when the question is omitted", () => {
    let advisorTool: any;
    const mockPi = {
      registerTool(tool: any) {
        if (tool.name === "ask_advisor") advisorTool = tool;
      },
      registerCommand() {},
      on() {},
      getActiveTools() {
        return [];
      },
    } as unknown as ExtensionAPI;
    registerExtension(mockPi);

    expect(advisorTool.description).toContain("empty object");
    expect(advisorTool.promptSnippet).toContain("existing context");
    expect(advisorTool.promptGuidelines.join(" ")).toContain("empty object");
    expect(ADVISOR_SYSTEM).toContain("No question or other input from the Executor is needed");
    const theme = {
      fg: (_color: string, text: string) => text,
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };
    const context = { lastComponent: undefined, state: {}, invalidate() {} };
    const noQuestionCall = advisorTool.renderCall({}, theme, context).render(120).join("\n");
    expect(noQuestionCall).toContain("[advisor] Executor → Advisor");
    expect(noQuestionCall).not.toContain("General task review");
    expect(resolveAdvisorRequest()).toBeUndefined();
    expect(resolveAdvisorRequest("   ")).toBeUndefined();
    expect(resolveAdvisorRequest("Review the migration plan.")).toBe("Review the migration plan.");
    expect(advisorMessageText("User: review this")).toBe("<conversation>\nUser: review this\n</conversation>");
    expect(advisorMessageText("User: review this", "Check the migration")).toContain("Targeted focus:\nCheck the migration");
  });

  test("injects only the enabled invocation rules into the active prompt", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(join(agentDir, "advisor.json"), JSON.stringify({
      advisorPlanGate: false,
      advisorFailureGate: true,
      advisorCompletionGate: false,
      advisorCustomInvocation: "a deployment changes production data",
    }));
    let beforeAgentStart: any;
    const mockPi = {
      registerTool() {},
      registerCommand() {},
      on(event: string, handler: any) { if (event === "before_agent_start") beforeAgentStart = handler; },
      getActiveTools() { return ["ask_advisor"]; },
    } as unknown as ExtensionAPI;

    try {
      registerExtension(mockPi);
      const result = beforeAgentStart({}, {
        cwd: tmpdir(),
        isProjectTrusted: () => false,
        getSystemPrompt: () => "Base prompt",
      });
      expect(result.systemPrompt).toContain("two consecutive materially equivalent failed attempts");
      expect(result.systemPrompt).toContain("a deployment changes production data");
      expect(result.systemPrompt).not.toContain("consequential plan");
      expect(result.systemPrompt).not.toContain("Before declaring success");
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  test("keeps Advisor settings on one screen and saves keyboard changes", () => {
    let saved: any;
    let renderRequests = 0;
    const selector = new AdvisorSettingsSelector({
      tui: { requestRender: () => { renderRequests++; } },
      theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text } as any,
      presets: [
        { label: "0", value: 0, description: "No history" },
        { label: "10k", value: 10_000, description: "Recent history" },
      ],
      effortLevels: ["Default (Model Default)", "high"],
      initial: { contextMaxChars: 0, planGate: true, failureGate: true, completionGate: true, collapseResponses: false },
      onSave: (settings) => { saved = settings; },
      onCancel: () => {},
    });
    selector.handleInput("\u001b[C");
    for (let index = 0; index < 12; index++) selector.handleInput("\u001b[B");
    selector.handleInput("\r");
    expect(renderRequests).toBe(13);
    expect(saved.contextMaxChars).toBe(10_000);
    const screen = selector.render(80).join("\n");
    expect(screen).toContain("Advisor reasoning");
    expect(screen).toContain("Custom invocation");
    expect(screen).toContain("▲");
  });

  test("edits the custom invocation rule inline", () => {
    let saved: any;
    const selector = new AdvisorSettingsSelector({
      tui: { requestRender() {} },
      theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text } as any,
      presets: [{ label: "0", value: 0, description: "No history" }],
      effortLevels: ["Default (Model Default)"],
      initial: { contextMaxChars: 0, planGate: true, failureGate: true, completionGate: true, collapseResponses: false },
      onSave: (settings) => { saved = settings; },
      onCancel: () => {},
    });
    for (let index = 0; index < 6; index++) selector.handleInput("\u001b[B");
    selector.handleInput("\r");
    selector.handleInput("d");
    selector.handleInput("e");
    selector.handleInput("p");
    selector.handleInput("l");
    selector.handleInput("o");
    selector.handleInput("y");
    selector.handleInput("\r");
    for (let index = 0; index < 6; index++) selector.handleInput("\u001b[B");
    selector.handleInput("\r");
    expect(saved.customRule).toBe("deploy");
  });

  test("keeps Advisor answers expanded unless collapse is enabled", () => {
    const longAnswer = Array.from({ length: 14 }, (_, index) => `line ${index + 1}`).join("\n");
    setAdvisorCollapseResponsesRef(false);
    expect(adviceForDisplay(longAnswer, false)).toBe(longAnswer);
    setAdvisorCollapseResponsesRef(true);
    expect(adviceForDisplay(longAnswer, false)).toContain("Ctrl+O to expand");
    expect(adviceForDisplay(longAnswer, true)).toBe(longAnswer);
    setAdvisorCollapseResponsesRef(false);
  });

  test("animates only while the advisor response is partial", () => {
    let advisorTool: any;
    const mockPi = {
      registerTool(tool: any) {
        if (tool.name === "ask_advisor") advisorTool = tool;
      },
      registerCommand() {},
      on() {},
      getActiveTools() {
        return [];
      },
    } as unknown as ExtensionAPI;
    registerExtension(mockPi);

    const theme = {
      fg: (_color: string, text: string) => text,
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };
    const context = { lastComponent: undefined, state: {} as { timerId?: ReturnType<typeof setInterval> }, invalidate() {} };
    const partial = advisorTool.renderResult({ content: [], details: {} }, { isPartial: true }, theme, context)
      .render(120).join("\n");
    expect(partial).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    expect(context.state.timerId).toBeDefined();

    advisorTool.renderResult({ content: [{ type: "text", text: "Done." }], details: {} }, { isPartial: false }, theme, context);
    expect(context.state.timerId).toBeUndefined();
  });
});
