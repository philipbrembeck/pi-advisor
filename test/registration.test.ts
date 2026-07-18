import { expect, test, describe } from "bun:test";
import registerExtension from "../extensions/index.js";
import { DEFAULT_ADVISOR_REQUEST, resolveAdvisorRequest } from "../src/tools.js";
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
    expect(registeredCommands).toContain("advisor-off");
  });

  test("distinguishes the executor request from the advisor response", () => {
    let advisorTool: any;
    const mockPi = {
      registerTool(tool: any) {
        if (tool.name === "ask_advisor") advisorTool = tool;
      },
      registerCommand() {},
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

  test("uses a general contextual request when the question is omitted", () => {
    expect(resolveAdvisorRequest()).toBe(DEFAULT_ADVISOR_REQUEST);
    expect(resolveAdvisorRequest("   ")).toBe(DEFAULT_ADVISOR_REQUEST);
    expect(resolveAdvisorRequest("Review the migration plan.")).toBe("Review the migration plan.");
  });

  test("animates only while the advisor response is partial", () => {
    let advisorTool: any;
    const mockPi = {
      registerTool(tool: any) {
        if (tool.name === "ask_advisor") advisorTool = tool;
      },
      registerCommand() {},
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
