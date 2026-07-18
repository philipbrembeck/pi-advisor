import { expect, test, describe } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import registerExtension from "../extensions/index.js";
import { ADVISOR_SYSTEM, adviceForDisplay, advisorMessageText, resolveAdvisorRequest } from "../src/tools.js";
import { setAdvisorCollapseResponsesRef } from "../src/config.js";
import { AdvisorSettingsSelector } from "../src/ui.js";
import { initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

initTheme();

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
    expect(registeredCommands).toContain("advisor-models");
    expect(registeredCommands).toContain("advisor-settings");
    expect(registeredCommands).toContain("advisor-off");
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
    for (let index = 0; index < 7; index++) selector.handleInput("\u001b[B");
    selector.handleInput("\r");
    expect(renderRequests).toBe(8);
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
    selector.handleInput("\u001b[B");
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
