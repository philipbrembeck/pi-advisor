import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import registerExtension from "../extensions/index.ts";
import { setShowUsageDetailsRef } from "../src/config.ts";
import {
  ADVISOR_SYSTEM,
  advisorMessageText,
  resolveAdvisorRequest,
} from "../src/tools.ts";
import { mockPi } from "./helpers/mock-pi.ts";

const SPINNER_PATTERN = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

initTheme();

const renderTheme = () => ({
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
});

const registerForRendering = (): any => {
  const tools = new Map<string, any>();
  registerExtension(mockPi({ tools }));
  return tools.get("ask_advisor");
};

const usageResult = () => ({
  content: [{ text: "Advisor (test/model)\n\n**Ship it.**", type: "text" }],
  details: {
    advisor: "test/model",
    text: "**Ship it.**",
    usage: { cacheRead: 20, cost: 0.0123, input: 1200, output: 456 },
  },
});

describe("Advisor tool rendering", () => {
  // Isolate the agent dir so the developer's real hide_thinking setting cannot collapse thinking previews.
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  beforeEach(() => {
    process.env.PI_CODING_AGENT_DIR = mkdtempSync(
      join(tmpdir(), "pi-advisor-render-")
    );
  });
  afterEach(() => {
    rmSync(process.env.PI_CODING_AGENT_DIR as string, {
      force: true,
      recursive: true,
    });
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  });

  test("renders the Executor request and the Advisor response distinctly", () => {
    setShowUsageDetailsRef(true);
    const advisorTool = registerForRendering();

    expect(advisorTool.parameters.required).toBeUndefined();
    expect(advisorTool.parameters.properties.includeTrackedFiles).toBeDefined();

    const theme = renderTheme();
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
      .renderResult(usageResult(), { isPartial: false }, theme, context)
      .render(120)
      .join("\n");

    expect(request).toContain("[advisor] Executor → Advisor");
    expect(request).toContain("Should we ship this change?");
    expect(request).not.toMatch(SPINNER_PATTERN);
    expect(response).toContain("ADVISOR RESPONSE");
    expect(response).toContain("test/model");
    expect(response).toContain("Usage: ↑1.2k · ↓456 · cr:20 · $0.0123");
    expect(response).toContain("Ship it.");
    expect(response).not.toContain("**Ship it.**");
    expect(response).not.toContain("Advisor (test/model)");
  });

  test("hides usage details from the response when disabled", () => {
    const advisorTool = registerForRendering();
    const theme = renderTheme();
    const context = {
      invalidate: () => undefined,
      lastComponent: undefined,
      state: {},
    };
    setShowUsageDetailsRef(false);
    try {
      const hiddenUsage = advisorTool
        .renderResult(usageResult(), { isPartial: false }, theme, context)
        .render(120)
        .join("\n");
      expect(hiddenUsage).not.toContain("Usage:");
    } finally {
      setShowUsageDetailsRef(true);
    }
  });

  test("renders partial streaming text without internals", () => {
    const advisorTool = registerForRendering();
    const theme = renderTheme();
    const context = {
      invalidate: () => undefined,
      lastComponent: undefined,
      state: {},
    };
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
    const advisorTool = registerForRendering();

    expect(advisorTool.description).toContain("empty object");
    expect(advisorTool.promptSnippet).toContain("existing context");
    expect(advisorTool.promptGuidelines.join(" ")).toContain("empty object");
    expect(advisorTool.promptGuidelines.join(" ")).toContain(
      "sequential follow-up"
    );
    expect(ADVISOR_SYSTEM).toContain(
      "No question or other input from the Executor is needed"
    );
    const theme = renderTheme();
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

  test("renders the shared expanded Scout fallback entry", () => {
    setShowUsageDetailsRef(true);
    const entryRenderers = new Map<string, any>();
    registerExtension(
      mockPi({ entryRenderers }, { registerTool: () => undefined })
    );
    const theme = renderTheme();
    const fallback = entryRenderers
      .get("advisor-scout-result")(
        {
          data: {
            availableCount: 4,
            fallbackReason: "timeout: Scout timed out",
            model: "provider/executor",
            omittedBeforeScout: 2,
            selectedCount: 0,
            status: "fallback",
            usage: { cacheRead: 2, cost: 0.003, input: 80, output: 10 },
          },
        },
        { expanded: true },
        theme
      )
      .render(120)
      .join("\n");
    expect(fallback).toContain("SCOUT · FALLBACK");
    expect(fallback).toContain("timeout: Scout timed out");
    expect(fallback).toContain("Usage: ↑80 · ↓10 · cr:2 · $0.0030");
    expect(fallback).toContain("2 group(s) omitted before Scout");

    setShowUsageDetailsRef(false);
    try {
      const hiddenUsage = entryRenderers
        .get("advisor-scout-result")(
          {
            data: {
              availableCount: 4,
              model: "provider/executor",
              selectedCount: 0,
              status: "fallback",
              usage: { cacheRead: 2, cost: 0.003, input: 80, output: 10 },
            },
          },
          { expanded: false },
          theme
        )
        .render(120)
        .join("\n");
      expect(hiddenUsage).not.toContain("Usage:");
    } finally {
      setShowUsageDetailsRef(true);
    }
  });

  test("renders the Scout streaming phase before the Advisor response", () => {
    const advisorTool = registerForRendering();
    const theme = renderTheme();
    const context = {
      invalidate: () => undefined,
      lastComponent: undefined,
      state: {} as { phase?: string; timerId?: ReturnType<typeof setInterval> },
    };
    const scouting = advisorTool
      .renderResult(
        {
          content: [],
          details: {
            scout: {
              model: "provider/executor",
              status: "streaming",
              thinking:
                "**Selecting relevant context**\n\n- preserve failed attempts",
            },
          },
        },
        { expanded: false, isPartial: true },
        theme,
        context
      )
      .render(120)
      .join("\n");
    expect(scouting).toContain("SCOUT");
    expect(scouting).not.toContain("ADVISOR");
    expect(scouting).toContain("Selecting relevant context");
    expect(scouting).toContain("preserve failed attempts");
    expect(scouting).not.toContain("**Selecting relevant context**");
    expect(context.state.timerId).toBeDefined();
  });

  test("transitions from Scout streaming to curated alongside Advisor streaming", () => {
    const advisorTool = registerForRendering();
    const theme = renderTheme();
    const context = {
      invalidate: () => undefined,
      lastComponent: undefined,
      state: {} as { phase?: string; timerId?: ReturnType<typeof setInterval> },
    };
    advisorTool.renderResult(
      {
        content: [],
        details: {
          scout: {
            model: "provider/executor",
            status: "streaming",
            thinking: "",
          },
        },
      },
      { expanded: false, isPartial: true },
      theme,
      context
    );
    const scoutTimer = context.state.timerId;
    const advising = advisorTool
      .renderResult(
        {
          content: [],
          details: {
            scout: {
              availableCount: 3,
              latencyMs: 100,
              model: "provider/executor",
              selectedCount: 2,
              status: "curated",
            },
            text: "**Partial recommendation**",
            thinking: "**Streaming review**\n\n- partial check",
          },
        },
        { expanded: false, isPartial: true },
        theme,
        context
      )
      .render(120)
      .join("\n");
    expect(advising).toContain("SCOUT · CURATED");
    expect(advising).toContain("ADVISOR");
    expect(advising).toContain("Streaming review");
    expect(advising).toContain("partial check");
    expect(advising).not.toContain("**Streaming review**");
    expect(advising).not.toContain("**Partial recommendation**");
    expect(context.state.timerId).toBeDefined();
    expect(context.state.timerId).not.toBe(scoutTimer);
  });

  test("clears render timers on the final completed render", () => {
    const advisorTool = registerForRendering();
    const theme = renderTheme();
    const context = {
      invalidate: () => undefined,
      lastComponent: undefined,
      state: {} as { phase?: string; timerId?: ReturnType<typeof setInterval> },
    };
    advisorTool.renderResult(
      {
        content: [],
        details: {
          scout: { model: "provider/executor", status: "streaming" },
        },
      },
      { expanded: false, isPartial: true },
      theme,
      context
    );
    const final = advisorTool
      .renderResult(
        {
          content: [{ text: "Done.", type: "text" }],
          details: {
            advisor: "provider/advisor",
            scout: {
              availableCount: 3,
              model: "provider/executor",
              selectedCount: 2,
              selectedLabels: ["current task"],
              status: "curated",
              synthesis: "Open decision",
            },
            text: "**Done.**",
            thinking:
              "**Reviewing the final recommendation**\n\n- check validation",
          },
        },
        { expanded: true, isPartial: false },
        theme,
        context
      )
      .render(120)
      .join("\n");
    expect(final).toContain("Reviewing the final recommendation");
    expect(final).toContain("check validation");
    expect(final).not.toContain("**Reviewing the final recommendation**");
    expect(final).not.toContain("**Done.**");
    expect(context.state.timerId).toBeUndefined();
  });

  test("preserves Scout cancellation across the final thrown-tool render", () => {
    const advisorTool = registerForRendering();
    const theme = renderTheme();
    const context = {
      invalidate: () => undefined,
      lastComponent: undefined,
      state: {} as any,
    };
    advisorTool.renderResult(
      {
        content: [],
        details: {
          scout: { model: "provider/executor", status: "cancelled" },
        },
      },
      { expanded: false, isPartial: true },
      theme,
      context
    );
    const final = advisorTool
      .renderResult(
        {
          content: [{ text: "This operation was aborted", type: "text" }],
        },
        { expanded: false, isPartial: false },
        theme,
        context
      )
      .render(120)
      .join("\n");
    expect(final).toContain("SCOUT · CANCELLED");
    expect(final).not.toContain("ADVISOR RESPONSE");
    expect(final).not.toContain("This operation was aborted");
    expect(context.state.timerId).toBeUndefined();
  });

  test("animates only while the advisor response is partial", () => {
    const advisorTool = registerForRendering();
    const theme = renderTheme();
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

describe("Pi hide_thinking integration", () => {
  const settingsTheme = {
    bg: (_c: string, t: string) => t,
    bold: (t: string) => t,
    fg: (_c: string, t: string) => t,
  };

  test("collapses the thinking preview to its label when hide_thinking is on", async () => {
    const { piHideThinkingEnabled } = await import("../src/pi-settings.ts");
    const { renderThinkingMarkdown } = await import(
      "../src/tools/render-common.ts"
    );
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-hidden-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      writeFileSync(
        join(agentDir, "settings.json"),
        JSON.stringify({ hideThinkingBlock: true })
      );
      expect(piHideThinkingEnabled()).toBe(true);
      const collapsed = renderThinkingMarkdown(
        "**Secret internal reasoning**",
        settingsTheme
      );
      const lines = collapsed.render(80);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("Thinking…");
      expect(lines[0]).not.toContain("Secret internal reasoning");
    } finally {
      if (previous === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previous;
      }
      rmSync(agentDir, { force: true, recursive: true });
    }
  });
});

describe("ask_advisor result spacing", () => {
  test("renders one blank line between the request and the first Scout line", async () => {
    const { renderAdvisorCallBox } = await import("../src/tools.ts");
    const { renderAdvisorResult } = await import(
      "../src/tools/render-advisor-result.ts"
    );
    const { Box } = await import("@earendil-works/pi-tui");
    const theme = renderTheme();
    const contentBox = new Box(1, 1, (text: string) =>
      theme.bg("toolSuccessBg", text)
    );
    contentBox.addChild(
      renderAdvisorCallBox(
        "test",
        theme as unknown as Parameters<typeof renderAdvisorCallBox>[1]
      )
    );
    contentBox.addChild(
      renderAdvisorResult(
        {
          content: [{ text: "Received: test.", type: "text" }],
          details: {
            advisor: "provider/advisor",
            scout: {
              availableCount: 2,
              latencyMs: 7500,
              model: "provider/executor",
              selectedCount: 2,
              status: "curated",
            },
            text: "Received: test.",
          },
        },
        { expanded: false, isPartial: false },
        theme as unknown as Parameters<typeof renderAdvisorResult>[2],
        {
          invalidate: () => undefined,
          lastComponent: undefined,
          state: {} as any,
        } as any
      )
    );
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal SGR codes
    const sgr = /\u001b\[[0-9;]*m/g;
    const lines = contentBox.render(120).map((line) => line.replace(sgr, ""));
    const questionAt = lines.findIndex((line) => line.includes("test"));
    const scoutAt = lines.findIndex((line) => line.includes("◆ SCOUT"));
    expect(questionAt).toBeGreaterThanOrEqual(0);
    expect(scoutAt).toBeGreaterThan(questionAt);
    const blankBetween = lines
      .slice(questionAt + 1, scoutAt)
      .every((line) => line.trim() === "");
    expect(blankBetween).toBe(true);
    expect(scoutAt - questionAt).toBe(2);
  });
});
