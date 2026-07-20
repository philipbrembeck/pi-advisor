import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, initTheme } from "@earendil-works/pi-coding-agent";
import registerExtension, {
  consultAdvisor,
  runAdvisorGate,
} from "../extensions/index.js";
import { registerCommands } from "../src/commands.js";
import { setAdvisorCollapseResponsesRef } from "../src/config.js";
import {
  createHerdrNotificationRequest,
  HerdrAdvisorActivity,
} from "../src/herdr.js";
import {
  ADVISOR_DECISION_SYSTEM,
  ADVISOR_SYSTEM,
  adviceForDisplay,
  advisorMessageText,
  gateFailureEffectForMode,
  parseAutomaticDecision,
  resolveAdvisorRequest,
} from "../src/tools.js";
import { AdvisorSettingsSelector } from "../src/ui.js";

initTheme();

const SPINNER_PATTERN = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
const MAX_CALLS_ROW_PATTERN = /Max Advisor calls\/session\s+10/;

describe("Herdr Advisor activity", () => {
  test("constructs sanitized request notifications within Herdr limits", () => {
    const request = createHerdrNotificationRequest(
      "bad\n title",
      "  details\u0000 with   spacing "
    );
    expect(request.method).toBe("notification.show");
    expect(request.params).toMatchObject({
      body: "details with spacing",
      position: "top-left",
      sound: "request",
      title: "bad title",
    });
    expect(request.params.title.length).toBeLessThanOrEqual(80);
    expect(request.params.body.length).toBeLessThanOrEqual(240);
  });
  test("keeps seeking advice visible until overlapping consultations finish", () => {
    const reports: any[] = [];
    const activity = new HerdrAdvisorActivity((request) =>
      reports.push(request)
    );

    activity.start();
    activity.start();
    activity.finish();
    expect(reports).toHaveLength(1);
    expect(reports[0].params).toMatchObject({
      agent: "pi",
      applies_to_source: "herdr:pi",
      state_labels: { working: "seeking advice" },
    });

    activity.finish();
    expect(reports).toHaveLength(2);
    expect(reports[1].params).toMatchObject({ clear_state_labels: true });
  });

  test("clears seeking advice on shutdown", () => {
    const reports: any[] = [];
    const activity = new HerdrAdvisorActivity((request) =>
      reports.push(request)
    );

    activity.start();
    activity.clear();
    activity.clear();

    expect(reports).toHaveLength(2);
    expect(reports[1].params).toMatchObject({ clear_state_labels: true });
  });

  test("does not report activity or blocked metadata when integration is disabled", () => {
    const reports: any[] = [];
    const activity = new HerdrAdvisorActivity(
      (request) => reports.push(request),
      () => false
    );
    activity.start();
    activity.finish();
    expect(reports).toHaveLength(0);
  });

  test("does not let unavailable Herdr reporting interrupt advice", () => {
    const activity = new HerdrAdvisorActivity(() => {
      throw new Error("socket unavailable");
    });

    expect(() => activity.start()).not.toThrow();
    expect(() => activity.finish()).not.toThrow();
  });
});

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
  });

  test("maps every configured gate failure mode without escalation", () => {
    expect(gateFailureEffectForMode("block-session")).toBe("session-blocked");
    expect(gateFailureEffectForMode("block-tool")).toBe("tool-blocked");
    expect(gateFailureEffectForMode("warn-and-continue")).toBe("continued");
  });

  test("does not retain the legacy JSON parser or synthesize normal verdicts", () => {
    const source = readFileSync(
      new URL("../src/tools.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toContain("parseAdvice");
    expect(source).not.toContain("JSON.parse");
    expect(
      parseAutomaticDecision("Decision: revise\nMarkdown explanation")
    ).not.toHaveProperty("verdict");
  });
});

describe("Extension Registration", () => {
  test("exports the stable consultation and gate contract", () => {
    expect(typeof consultAdvisor).toBe("function");
    expect(typeof runAdvisorGate).toBe("function");
    expect(typeof parseAutomaticDecision).toBe("function");
  });
  test("should register advisor tool and commands correctly", () => {
    const registeredTools: string[] = [];
    const registeredCommands: string[] = [];

    const mockPi = {
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand(name: string, _config: any) {
        registeredCommands.push(name);
      },
      registerTool(tool: any) {
        registeredTools.push(tool.name);
      },
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
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage(message: any, options: any) {
        sent.push({ message, options });
      },
    } as unknown as ExtensionAPI;

    registerCommands(mockPi, {
      consult: (_ctx, question) => {
        receivedQuestion = question;
        return Promise.resolve({
          markdown: "Ship the focused fix.",
          thinkingText: "",
        });
      },
    });

    await commands.get("advisor-manual").handler("Check the migration", {
      cwd: tmpdir(),
      hasUI: false,
      isProjectTrusted: () => false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(receivedQuestion).toBe("Check the migration");
    expect(sent).toEqual([
      {
        message: expect.objectContaining({
          content: expect.stringContaining("Ship the focused fix."),
          customType: "advisor-manual-result",
          details: expect.objectContaining({
            question: "Check the migration",
            text: "Ship the focused fix.",
          }),
        }),
        options: { deliverAs: "steer", triggerTurn: true },
      },
    ]);
  });

  test("adds an immediate Advisor call entry to the transcript", async () => {
    const commands = new Map<string, any>();
    const entries: Array<{ type: string; data: unknown }> = [];
    const mockPi = {
      appendEntry(type: string, data: unknown) {
        entries.push({ data, type });
      },
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage: () => undefined,
    } as unknown as ExtensionAPI;
    registerCommands(mockPi, {
      consult: () => new Promise(() => undefined),
    });

    await commands.get("advisor-manual").handler("Check the migration", {
      cwd: tmpdir(),
      hasUI: false,
      isProjectTrusted: () => false,
    });

    expect(entries).toEqual([
      {
        data: { question: "Check the migration" },
        type: "advisor-manual-call",
      },
    ]);
  });

  test("cancels a manual consultation before its late response can fan out", async () => {
    const commands = new Map<string, any>();
    const events = new Map<string, () => void>();
    const sent: unknown[] = [];
    let resolveConsult!: (value: {
      markdown: string;
      thinkingText: string;
    }) => void;
    const pendingConsult = new Promise<{
      markdown: string;
      thinkingText: string;
    }>((resolve) => {
      resolveConsult = resolve;
    });
    const mockPi = {
      getActiveTools() {
        return [];
      },
      on(event: string, handler: () => void) {
        events.set(event, handler);
      },
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage(message: unknown) {
        sent.push(message);
      },
    } as unknown as ExtensionAPI;

    registerCommands(mockPi, { consult: async () => pendingConsult });
    await commands.get("advisor-manual").handler("", {
      cwd: tmpdir(),
      hasUI: false,
      isProjectTrusted: () => false,
    });
    expect(sent).toEqual([]);

    events.get("session_shutdown")?.();
    resolveConsult({ markdown: "Too late.", thinkingText: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual([]);
  });

  test("replaces an in-flight manual consultation with a newer request", async () => {
    const commands = new Map<string, any>();
    const signals: AbortSignal[] = [];
    const mockPi = {
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage: () => undefined,
    } as unknown as ExtensionAPI;
    registerCommands(mockPi, {
      consult: (_ctx, _question, signal) => {
        if (!signal) {
          throw new Error("Manual consultation requires an abort signal.");
        }
        signals.push(signal);
        return new Promise<{ markdown: string; thinkingText: string }>(
          () => undefined
        );
      },
    });

    await commands.get("advisor-manual").handler("First", {
      cwd: tmpdir(),
      hasUI: false,
      isProjectTrusted: () => false,
    });
    await commands.get("advisor-manual").handler("Second", {
      cwd: tmpdir(),
      hasUI: false,
      isProjectTrusted: () => false,
    });

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  test("distinguishes the executor request from the advisor response", () => {
    let advisorTool: any;
    const mockPi = {
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand: () => undefined,
      registerTool(tool: any) {
        if (tool.name === "ask_advisor") {
          advisorTool = tool;
        }
      },
    } as unknown as ExtensionAPI;
    registerExtension(mockPi);

    expect(advisorTool.parameters.required).toBeUndefined();

    const theme = {
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    };
    const context = {
      invalidate: () => undefined,
      lastComponent: undefined,
      state: {},
    };
    const request = advisorTool
      .renderCall({ question: "Should we ship this change?" }, theme, context)
      .render(120)
      .join("\n");
    const response = advisorTool
      .renderResult(
        {
          content: [
            { text: "Advisor (test/model)\n\n**Ship it.**", type: "text" },
          ],
          details: { advisor: "test/model", text: "**Ship it.**" },
        },
        { isPartial: false },
        theme,
        context
      )
      .render(120)
      .join("\n");

    expect(request).toContain("[advisor] Executor → Advisor");
    expect(request).toContain("Should we ship this change?");
    expect(request).not.toMatch(SPINNER_PATTERN);
    expect(response).toContain("ADVISOR RESPONSE");
    expect(response).toContain("test/model");
    expect(response).toContain("Ship it.");
    expect(response).not.toContain("**Ship it.**");
    expect(response).not.toContain("Advisor (test/model)");

    const markdownPartial = advisorTool
      .renderResult(
        {
          content: [{ text: "The migration looks safe so far", type: "text" }],
          details: { text: "The migration looks safe so far" },
        },
        { isPartial: true },
        theme,
        context
      )
      .render(120)
      .join("\n");
    expect(markdownPartial).toContain("The migration looks safe so far");
    expect(markdownPartial).not.toContain("criticalFindings");
  });

  test("advertises and uses a general contextual request when the question is omitted", () => {
    let advisorTool: any;
    const mockPi = {
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand: () => undefined,
      registerTool(tool: any) {
        if (tool.name === "ask_advisor") {
          advisorTool = tool;
        }
      },
    } as unknown as ExtensionAPI;
    registerExtension(mockPi);

    expect(advisorTool.description).toContain("empty object");
    expect(advisorTool.promptSnippet).toContain("existing context");
    expect(advisorTool.promptGuidelines.join(" ")).toContain("empty object");
    expect(ADVISOR_SYSTEM).toContain(
      "No question or other input from the Executor is needed"
    );
    const theme = {
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    };
    const context = {
      invalidate: () => undefined,
      lastComponent: undefined,
      state: {},
    };
    const noQuestionCall = advisorTool
      .renderCall({}, theme, context)
      .render(120)
      .join("\n");
    expect(noQuestionCall).toContain("[advisor] Executor → Advisor");
    expect(noQuestionCall).not.toContain("General task review");
    expect(resolveAdvisorRequest()).toBeUndefined();
    expect(resolveAdvisorRequest("   ")).toBeUndefined();
    expect(resolveAdvisorRequest("Review the migration plan.")).toBe(
      "Review the migration plan."
    );
    expect(advisorMessageText("User: review this")).toBe(
      "<conversation>\nUser: review this\n</conversation>"
    );
    expect(
      advisorMessageText("User: review this", "Check the migration")
    ).toContain("Targeted focus:\nCheck the migration");
  });

  test("injects only the enabled invocation rules into the active prompt", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({
        advisorCompletionGate: false,
        advisorCustomInvocation: "a deployment changes production data",
        advisorFailureGate: true,
        advisorPlanGate: false,
      })
    );
    let beforeAgentStart: any;
    const mockPi = {
      getActiveTools() {
        return ["ask_advisor"];
      },
      on(event: string, handler: any) {
        if (event === "before_agent_start") {
          beforeAgentStart = handler;
        }
      },
      registerCommand: () => undefined,
      registerTool: () => undefined,
    } as unknown as ExtensionAPI;

    try {
      registerExtension(mockPi);
      const result = beforeAgentStart(
        {},
        {
          cwd: tmpdir(),
          getSystemPrompt: () => "Base prompt",
          isProjectTrusted: () => false,
        }
      );
      expect(result.systemPrompt).toContain(
        "two consecutive materially equivalent failed attempts"
      );
      expect(result.systemPrompt).toContain(
        "a deployment changes production data"
      );
      expect(result.systemPrompt).not.toContain("consequential plan");
      expect(result.systemPrompt).not.toContain("Before declaring success");
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("keeps Advisor settings on one screen and saves keyboard changes", () => {
    let saved: any;
    let renderRequests = 0;
    const selector = new AdvisorSettingsSelector({
      effortLevels: ["Default (Model Default)", "high"],
      initial: {
        collapseResponses: false,
        completionGate: true,
        contextMaxChars: 0,
        failureGate: true,
        planGate: true,
      },
      onCancel: () => undefined,
      onSave: (settings) => {
        saved = settings;
      },
      presets: [
        { description: "No history", label: "0", value: 0 },
        { description: "Recent history", label: "10k", value: 10_000 },
      ],
      theme: {
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
      } as any,
      tui: {
        requestRender: () => {
          renderRequests += 1;
        },
      },
    });
    selector.handleInput("\u001b[C");
    for (let index = 0; index < 16; index += 1) {
      selector.handleInput("\u001b[B");
    }
    selector.handleInput("\r");
    expect(renderRequests).toBe(17);
    expect(saved.contextMaxChars).toBe(10_000);
    const screen = selector.render(80).join("\n");
    expect(screen).toContain("Advisor reasoning");
    expect(screen).toContain("Custom invocation");
    expect(screen).toContain("Gate failure mode");
    expect(screen).toContain("Herdr integration");
    expect(screen).toContain("▲");
  });

  test("edits the custom invocation rule inline", () => {
    let saved: any;
    const selector = new AdvisorSettingsSelector({
      effortLevels: ["Default (Model Default)"],
      initial: {
        collapseResponses: false,
        completionGate: true,
        contextMaxChars: 0,
        failureGate: true,
        planGate: true,
      },
      onCancel: () => undefined,
      onSave: (settings) => {
        saved = settings;
      },
      presets: [{ description: "No history", label: "0", value: 0 }],
      theme: {
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
      } as any,
      tui: {
        requestRender: () => undefined,
      },
    });
    for (let index = 0; index < 6; index += 1) {
      selector.handleInput("\u001b[B");
    }
    selector.handleInput("\r");
    selector.handleInput("d");
    selector.handleInput("e");
    selector.handleInput("p");
    selector.handleInput("l");
    selector.handleInput("o");
    selector.handleInput("y");
    selector.handleInput("\r");
    for (let index = 0; index < 10; index += 1) {
      selector.handleInput("\u001b[B");
    }
    selector.handleInput("\r");
    expect(saved.customRule).toBe("deploy");
  });

  test("reopens Advisor settings with the value saved in the same session", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({ advisorMaxCallsPerSession: 5 })
    );
    const commands = new Map<string, any>();
    const theme = {
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    } as any;
    const custom = async (factory: any) =>
      new Promise<any>((resolve) => {
        const selector = factory(
          { requestRender: () => undefined },
          theme,
          {},
          resolve
        );
        for (let index = 0; index < 10; index += 1) {
          selector.handleInput("\u001b[B");
        }
        selector.handleInput("\u001b[C");
        for (let index = 0; index < 6; index += 1) {
          selector.handleInput("\u001b[B");
        }
        selector.handleInput("\r");
      });
    const reopened = async (factory: any) =>
      new Promise<any>((resolve) => {
        const selector = factory(
          { requestRender: () => undefined },
          theme,
          {},
          resolve
        );
        expect(selector.render(100).join("\n")).toMatch(MAX_CALLS_ROW_PATTERN);
        selector.handleInput("\u001b");
      });
    const mockPi = {
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
    } as unknown as ExtensionAPI;
    const context = {
      cwd: tmpdir(),
      hasUI: true,
      isProjectTrusted: () => false,
      ui: { custom, notify: () => undefined },
    } as any;

    try {
      registerCommands(mockPi);
      await commands.get("advisor-settings").handler("", context);
      expect(
        JSON.parse(readFileSync(join(agentDir, "advisor.json"), "utf8"))
      ).toMatchObject({ advisorMaxCallsPerSession: 10 });
      context.ui.custom = reopened;
      await commands.get("advisor-settings").handler("", context);
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("keeps Advisor answers expanded unless collapse is enabled", () => {
    const longAnswer = Array.from(
      { length: 14 },
      (_, index) => `line ${index + 1}`
    ).join("\n");
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
      getActiveTools() {
        return [];
      },
      on: () => undefined,
      registerCommand: () => undefined,
      registerTool(tool: any) {
        if (tool.name === "ask_advisor") {
          advisorTool = tool;
        }
      },
    } as unknown as ExtensionAPI;
    registerExtension(mockPi);

    const theme = {
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    };
    const context = {
      invalidate: () => undefined,
      lastComponent: undefined,
      state: {} as { timerId?: ReturnType<typeof setInterval> },
    };
    const partial = advisorTool
      .renderResult(
        { content: [], details: {} },
        { isPartial: true },
        theme,
        context
      )
      .render(120)
      .join("\n");
    expect(partial).toMatch(SPINNER_PATTERN);
    expect(context.state.timerId).toBeDefined();

    advisorTool.renderResult(
      { content: [{ text: "Done.", type: "text" }], details: {} },
      { isPartial: false },
      theme,
      context
    );
    expect(context.state.timerId).toBeUndefined();
  });
});
