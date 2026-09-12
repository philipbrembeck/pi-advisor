import { describe, expect, test } from "bun:test";
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
