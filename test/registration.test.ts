import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, initTheme } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import registerExtension, {
  consultAdvisor,
  runAdvisorGate,
} from "../extensions/index.js";
import { registerCommands } from "../src/commands.js";
import {
  advisorScoutEnabledRef,
  contextMaxCharsRef,
  getAdvisorSettings,
  loadConfig,
  resetConfigCache,
  setAdvisorCollapseResponsesRef,
  setAdvisorRedactSecretsRef,
  setAdvisorToolPoliciesRef,
  setShowUsageDetailsRef,
} from "../src/config.js";
import { clampGitContextLevel, type GitContextLevel } from "../src/git.js";
import {
  createHerdrNotificationRequest,
  HerdrAdvisorActivity,
  HerdrAdvisorBlock,
  setHerdrBlockedEmitter,
} from "../src/herdr.js";
import { AdvisorSessionState } from "../src/session-state.js";
import {
  ADVISOR_DECISION_SYSTEM,
  ADVISOR_SYSTEM,
  adviceForDisplay,
  advisorMessageText,
  advisorRequestConversation,
  advisorSessionState,
  curateAdvisorConversation,
  gateFailureEffectForMode,
  parseAutomaticDecision,
  registerAdvisorTool,
  renderThinkingMarkdown,
  resolveAdvisorRequest,
  ScoutStatusManager,
} from "../src/tools.js";
import { AdvisorSettingsSelector, SearchableModelSelector } from "../src/ui.js";

initTheme();

const SPINNER_PATTERN = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
const MAX_CALLS_ROW_PATTERN = /Max Advisor calls\/session\s+10/;
const SCOUT_ON_PATTERN = /Experimental Advisor Scout\s+On/;
const SIMPLE_MODE_ON = /→ Simple mode\s+On/;
const SIMPLE_MODE_OFF = /→ Simple mode\s+Off/;
const CONTEXT_WINDOW = /Context window/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal SGR codes
const SGR_CODE = /\u001b\[[0-9;]*m/g;

const withManualConfig = async (
  config: Record<string, unknown>,
  run: (agentDir: string) => Promise<void>
) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-manual-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  writeFileSync(join(agentDir, "advisor.json"), JSON.stringify(config));
  resetConfigCache();
  try {
    await run(agentDir);
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    resetConfigCache();
    rmSync(agentDir, { force: true, recursive: true });
  }
};

// Row navigation is resolved by label so that adding a settings row cannot
// silently retarget an existing test's keystrokes.
const focusSettingsRow = (selector: any, label: string): number => {
  for (let presses = 0; presses < 60; presses += 1) {
    const screen = selector.render(120).join("\n").replace(SGR_CODE, "");
    if (screen.includes(`→ ${label}`)) {
      return presses;
    }
    selector.handleInput("\u001b[B");
  }
  throw new Error(`Settings row not reachable: ${label}`);
};

const changeSetting = (selector: any, label: string): number => {
  const presses = focusSettingsRow(selector, label);
  selector.handleInput("\r");
  return presses;
};

describe("Searchable model selector", () => {
  const theme = {
    bold: (value: string) => value,
    fg: (_color: string, value: string) => value,
  } as any;
  const keybindings = { matches: () => false } as any;

  test("shows the current model first and ticked", () => {
    const selector = new SearchableModelSelector({
      allOptions: ["provider/other", "provider/current", "provider/last"],
      currentOption: "provider/current",
      keybindings,
      onCancel: () => undefined,
      onSelect: () => undefined,
      theme,
      title: "Select Model",
      tui: { requestRender: () => undefined },
    });

    const screen = selector.render(100).join("\n");
    expect(screen.indexOf("✓ provider/current")).toBeLessThan(
      screen.indexOf("provider/other")
    );
  });

  test("does not show a configured model that is unavailable", () => {
    let selected: string | undefined;
    const selector = new SearchableModelSelector({
      allOptions: ["provider/available"],
      currentOption: "provider/unavailable",
      keybindings,
      onCancel: () => undefined,
      onSelect: (value) => {
        selected = value;
      },
      theme,
      title: "Select Model",
      tui: { requestRender: () => undefined },
    });

    const screen = selector.render(100).join("\n");
    expect(screen).not.toContain("provider/unavailable");
    selector.handleInput("\r");
    expect(selected).toBe("provider/available");
  });

  test("keeps the current model when Enter is pressed immediately", () => {
    let selected: string | undefined;
    const selector = new SearchableModelSelector({
      allOptions: ["provider/other", "provider/current"],
      currentOption: "provider/current",
      keybindings,
      onCancel: () => undefined,
      onSelect: (value) => {
        selected = value;
      },
      theme,
      title: "Select Model",
      tui: { requestRender: () => undefined },
    });

    selector.render(100);
    selector.handleInput("\r");
    expect(selected).toBe("provider/current");
  });
});

describe("Advisor model command thinking levels", () => {
  test("shows configured levels first and keeps them on Enter", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({
        advisor: "provider/advisor",
        advisorEffort: "high",
        executor: "provider/executor",
        executorEffort: "low",
      })
    );
    resetConfigCache();
    const commands = new Map<string, any>();
    const mockPi = {
      getActiveTools: () => [],
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
    } as unknown as ExtensionAPI;
    const effortChoicesSeen: string[][] = [];
    const theme = {
      bold: (value: string) => value,
      fg: (_color: string, value: string) => value,
    } as any;

    try {
      registerCommands(mockPi);
      await commands.get("advisor-models").handler("", {
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: {
          getAvailable: () => [
            { id: "executor", provider: "provider" },
            { id: "advisor", provider: "provider" },
          ],
        },
        ui: {
          custom: (factory: any) =>
            new Promise((resolve) => {
              const selector = factory(
                { requestRender: () => undefined },
                theme,
                { matches: () => false },
                resolve
              );
              selector.render(100);
              selector.handleInput("\r");
            }),
          notify: () => undefined,
          select: (_title: string, choices: string[]) => {
            effortChoicesSeen.push(choices);
            return Promise.resolve(choices[0]);
          },
        },
      } as any);

      expect(effortChoicesSeen).toEqual([
        [
          "✓ low",
          "Default (Model Default)",
          "off",
          "minimal",
          "medium",
          "high",
          "xhigh",
          "max",
        ],
        [
          "✓ high",
          "Default (Model Default)",
          "off",
          "minimal",
          "low",
          "medium",
          "xhigh",
          "max",
        ],
      ]);
      const saved = JSON.parse(
        readFileSync(join(agentDir, "advisor.json"), "utf8")
      );
      expect(saved.executorEffort).toBe("low");
      expect(saved.advisorEffort).toBe("high");
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });
});

describe("Herdr Advisor activity", () => {
  test("constructs sanitized request notifications within Herdr limits", () => {
    const request = createHerdrNotificationRequest(
      "bad\n title",
      "  details\u0000 with   spacing "
    );
    expect(request.method).toBe("notification.show");
    expect(request.params).toEqual({
      body: "details with spacing",
      position: "top-left",
      sound: "request",
      title: "bad title",
    });
    expect(Object.keys(request).sort()).toEqual(["id", "method", "params"]);
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
    expect(Object.keys(reports[0].params).sort()).toEqual([
      "agent",
      "applies_to_source",
      "pane_id",
      "seq",
      "source",
      "state_labels",
    ]);

    activity.finish();
    expect(reports).toHaveLength(2);
    expect(reports[1].params).toMatchObject({ clear_state_labels: true });
    expect(reports[1].params).not.toHaveProperty("state_labels");
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

  test("redacts and bounds blocked labels and clears after integration is disabled", () => {
    const reports: any[] = [];
    let enabled = true;
    const block = new HerdrAdvisorBlock(
      (request) => reports.push(request),
      () => enabled
    );
    block.set(`token=super-secret-token-value\n${"x".repeat(500)}`);
    enabled = false;
    block.clear();
    block.clear();

    expect(reports).toHaveLength(2);
    expect(reports[0].params.state_labels.blocked).toContain(
      "[REDACTED SECRET]"
    );
    expect(reports[0].params.state_labels.blocked).not.toContain(
      "super-secret-token-value"
    );
    expect(reports[0].params.state_labels.blocked.length).toBeLessThanOrEqual(
      200
    );
    expect(reports[1].params).toMatchObject({ clear_state_labels: true });
  });

  test("emits one herdr:blocked edge per block and one clear", () => {
    const events: boolean[] = [];
    setHerdrBlockedEmitter((active) => events.push(active));
    try {
      const block = new HerdrAdvisorBlock(
        () => undefined,
        () => true
      );
      block.set("first");
      block.set("second");
      block.clear();
      block.clear();

      expect(events).toEqual([true, false]);
    } finally {
      setHerdrBlockedEmitter(undefined);
    }
  });
});

describe("Scout status ownership", () => {
  const context = (statuses: Array<string | undefined>) =>
    ({
      hasUI: true,
      ui: {
        setStatus: (_key: string, value: string | undefined) =>
          statuses.push(value),
      },
    }) as any;

  test("keeps a newer active status when an older invocation releases", () => {
    const statuses: Array<string | undefined> = [];
    const manager = new ScoutStatusManager();
    const ctx = context(statuses);
    const older = Symbol("older");
    const newer = Symbol("newer");
    manager.update(ctx, older, { model: "executor", type: "call" });
    manager.update(ctx, newer, { model: "executor", type: "call" });
    manager.release(ctx, older);
    expect(statuses.at(-1)).toBe("Scout curating…");
    manager.release(ctx, newer);
    expect(statuses.at(-1)).toBeUndefined();
  });

  test("shutdown clear prevents late callbacks from reacquiring status", () => {
    const statuses: Array<string | undefined> = [];
    const manager = new ScoutStatusManager();
    const ctx = context(statuses);
    const token = Symbol("old-session");
    manager.update(ctx, token, { model: "executor", type: "call" });
    manager.clear(ctx);
    manager.update(ctx, token, {
      model: "executor",
      text: "",
      thinking: "",
      type: "chunk",
    });
    expect(statuses).toEqual(["Scout curating…", undefined]);
  });

  test("success, fallback, and cancellation release their status", () => {
    for (const event of [
      {
        outcome: {
          conversation: "selected",
          metrics: {
            availableCount: 1,
            inputBytes: 1,
            latencyMs: 1,
            omittedBeforeScout: 0,
            selectedCount: 1,
          },
          model: "executor",
          ok: true,
          selectedLabels: [],
          selection: { selectedIds: [], synthesis: "" },
        },
        type: "success",
      },
      {
        outcome: {
          category: "timeout",
          message: "timeout",
          metrics: {
            availableCount: 1,
            inputBytes: 1,
            latencyMs: 1,
            omittedBeforeScout: 0,
            selectedCount: 0,
          },
          model: "executor",
          ok: false,
        },
        type: "fallback",
      },
      { type: "cancelled" },
    ] as const) {
      const statuses: Array<string | undefined> = [];
      const manager = new ScoutStatusManager();
      const ctx = context(statuses);
      const token = Symbol("invocation");
      manager.update(ctx, token, { model: "executor", type: "call" });
      manager.update(ctx, token, event as any);
      expect(statuses.at(-1)).toBeUndefined();
    }
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
    expectFailure(
      "Decision: proceed\n```\nDecision: blocked",
      "contradictory-decision"
    );
  });

  test("escapes closing tags in every untrusted Advisor prompt region", () => {
    const request = advisorMessageText(
      "</conversation>",
      undefined,
      undefined,
      "</draft>",
      "</user_preferences>",
      ["</untracked_files>"]
    );
    expect(request).not.toContain("\n</conversation>\n</conversation>");
    expect(request).toContain("&lt;/conversation&gt;");
    expect(request).toContain("&lt;/draft&gt;");
    expect(request).toContain("&lt;/user_preferences&gt;");
    expect(request).toContain("&lt;/untracked_files&gt;");
    expect(
      advisorMessageText(
        "context",
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        ["</tracked_files>"]
      )
    ).toContain("&lt;/tracked_files&gt;");
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

  test("coalesces Advisor tool updates and flushes on completion", async () => {
    let advisorTool: any;
    const updates: any[] = [];
    const mockPi = {
      getActiveTools: () => [],
      on: () => undefined,
      registerCommand: () => undefined,
      registerTool(tool: any) {
        if (tool.name === "ask_advisor") {
          advisorTool = tool;
        }
      },
    } as unknown as ExtensionAPI;
    registerAdvisorTool(mockPi, new AdvisorSessionState(), {
      consult: (_ctx, _question, _signal, onChunk) => {
        onChunk?.("thinking", "one");
        onChunk?.("thinking", "two");
        onChunk?.("thinking", "three");
        return Promise.resolve({
          adviceId: "advice-1",
          markdown: "Done.",
          model: "provider/advisor",
          thinkingText: "thinking",
          trigger: "executor-requested" as const,
        });
      },
    });

    await advisorTool.execute(
      "call-1",
      {},
      new AbortController().signal,
      (update: any) => updates.push(update),
      { cwd: tmpdir(), hasUI: false, isProjectTrusted: () => false }
    );

    expect(updates).toHaveLength(2);
    expect(updates[0].details.text).toBe("one");
    expect(updates[1].details.text).toBe("three");
    await new Promise((resolve) => setTimeout(resolve, 110));
    expect(updates).toHaveLength(2);
  });

  test("flushes the latest Advisor update before surfacing an error", async () => {
    let advisorTool: any;
    const updates: any[] = [];
    const mockPi = {
      getActiveTools: () => [],
      on: () => undefined,
      registerCommand: () => undefined,
      registerTool(tool: any) {
        if (tool.name === "ask_advisor") {
          advisorTool = tool;
        }
      },
    } as unknown as ExtensionAPI;
    registerAdvisorTool(mockPi, new AdvisorSessionState(), {
      consult: (_ctx, _question, _signal, onChunk) => {
        onChunk?.("thinking", "one");
        onChunk?.("thinking", "two");
        return Promise.reject(new Error("provider failed"));
      },
    });

    await expect(
      advisorTool.execute(
        "call-2",
        {},
        new AbortController().signal,
        (update: any) => updates.push(update),
        { cwd: tmpdir(), hasUI: false, isProjectTrusted: () => false }
      )
    ).rejects.toThrow("provider failed");

    expect(updates).toHaveLength(2);
    expect(updates[1].details.text).toBe("two");
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

  test("shows manual Advisor progress and forwards response chunks", async () => {
    const commands = new Map<string, any>();
    const statuses: Array<string | undefined> = [];
    const chunks: string[] = [];
    const mockPi = {
      getActiveTools: () => [],
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage: () => undefined,
    } as unknown as ExtensionAPI;
    registerCommands(mockPi, {
      consult: (_ctx, _question, _signal, onChunk, onScout) => {
        onScout?.({ model: "provider/executor", type: "call" });
        onScout?.({
          outcome: {
            conversation: "selected evidence",
            metrics: {
              availableCount: 1,
              inputBytes: 10,
              latencyMs: 12,
              omittedBeforeScout: 0,
              selectedCount: 1,
            },
            model: "provider/executor",
            ok: true,
            selectedLabels: [],
            selection: { selectedIds: [], synthesis: "" },
          },
          type: "success",
        });
        onChunk?.("Thinking about the request", "");
        chunks.push("thinking");
        onChunk?.("", "The answer is ready");
        chunks.push("response");
        return Promise.resolve({ markdown: "Proceed.", thinkingText: "" });
      },
    });
    const ctx = {
      cwd: tmpdir(),
      hasUI: true,
      isProjectTrusted: () => false,
      ui: {
        setStatus(key: string, value: string | undefined) {
          if (key === "advisor-manual") {
            statuses.push(value);
          }
        },
      },
    } as any;

    await commands.get("advisor-manual").handler("Check", ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chunks).toEqual(["thinking", "response"]);
    expect(statuses.every((status) => status === undefined)).toBe(true);
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

    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("advisor-manual-call");
    expect(entries[0]?.data).toMatchObject({
      progressId: expect.any(String),
      question: "Check the migration",
    });
  });

  test("renders one terminal manual Scout entry before the Advisor response", async () => {
    const commands = new Map<string, any>();
    const entries: Array<{ type: string; data: any }> = [];
    const timeline: string[] = [];
    const mockPi = {
      appendEntry(type: string, data: unknown) {
        entries.push({ data, type });
        timeline.push(type);
      },
      getActiveTools: () => [],
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage(message: any) {
        timeline.push(message.customType);
      },
    } as unknown as ExtensionAPI;
    registerCommands(mockPi, {
      consult: (_ctx, _question, _signal, _onChunk, onScout) => {
        onScout?.({ model: "provider/executor", type: "call" });
        onScout?.({
          outcome: {
            conversation: "selected evidence",
            metrics: {
              availableCount: 3,
              inputBytes: 100,
              latencyMs: 12,
              omittedBeforeScout: 1,
              selectedCount: 2,
            },
            model: "provider/executor",
            ok: true,
            selectedLabels: ["current request"],
            selection: {
              selectedIds: ["g_required"],
              synthesis: "Open decision",
            },
          },
          type: "success",
        });
        return Promise.resolve({ markdown: "Proceed.", thinkingText: "" });
      },
    });
    await commands.get("advisor-manual").handler("Check", {
      cwd: tmpdir(),
      hasUI: false,
      isProjectTrusted: () => false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timeline).toEqual([
      "advisor-manual-call",
      "advisor-scout-result",
      "advisor-manual-result",
    ]);
    expect(entries[1].data).toMatchObject({
      model: "provider/executor",
      selectedCount: 2,
      status: "curated",
    });
  });

  test("cancels a manual consultation before its late response can fan out", async () => {
    const commands = new Map<string, any>();
    const events = new Map<
      string,
      (event?: unknown, ctx?: { hasUI?: boolean }) => void
    >();
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
      on(event: string, handler: any) {
        events.set(event, handler);
      },
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage(message: unknown) {
        sent.push(message);
      },
    } as unknown as ExtensionAPI;

    advisorSessionState.resetTask();
    registerCommands(mockPi, { consult: async () => pendingConsult });
    await commands.get("advisor-manual").handler("", {
      cwd: tmpdir(),
      hasUI: false,
      isProjectTrusted: () => false,
    });
    expect(sent).toEqual([]);

    events.get("session_shutdown")?.(undefined, { hasUI: false });
    resolveConsult({ markdown: "Too late.", thinkingText: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual([]);
    expect(advisorSessionState.summary(undefined)).toBeUndefined();
  });

  test("suppresses late Scout lifecycle from a shutdown manual consultation", async () => {
    const commands = new Map<string, any>();
    const events = new Map<
      string,
      (event?: unknown, ctx?: { hasUI?: boolean }) => void
    >();
    const entries: string[] = [];
    let lateScout: ((event: any) => void) | undefined;
    const mockPi = {
      appendEntry(type: string) {
        entries.push(type);
      },
      getActiveTools: () => [],
      on(event: string, handler: any) {
        events.set(event, handler);
      },
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage: () => undefined,
    } as unknown as ExtensionAPI;
    registerCommands(mockPi, {
      consult: (_ctx, _question, _signal, _onChunk, onScout) => {
        lateScout = onScout;
        return new Promise(() => undefined);
      },
    });
    await commands.get("advisor-manual").handler("", {
      cwd: tmpdir(),
      hasUI: false,
      isProjectTrusted: () => false,
    });
    expect(entries).toEqual(["advisor-manual-call"]);
    events.get("session_shutdown")?.(undefined, { hasUI: false });
    lateScout?.({ model: "provider/executor", type: "call" });
    expect(entries).toEqual(["advisor-manual-call"]);
  });

  test("keeps manual Scout progress out of the footer", async () => {
    const commands = new Map<string, any>();
    const events = new Map<string, any>();
    const statuses: Array<string | undefined> = [];
    const mockPi = {
      appendEntry: () => undefined,
      getActiveTools: () => [],
      on(event: string, handler: any) {
        events.set(event, handler);
      },
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage: () => undefined,
    } as unknown as ExtensionAPI;
    registerCommands(mockPi, {
      consult: (_ctx, _question, _signal, _onChunk, onScout) => {
        onScout?.({ model: "executor", type: "call" });
        return new Promise(() => undefined);
      },
    });
    const ctx = {
      cwd: tmpdir(),
      hasUI: true,
      isProjectTrusted: () => false,
      ui: {
        setStatus: (_key: string, value: string | undefined) =>
          statuses.push(value),
      },
    } as any;
    await commands.get("advisor-manual").handler("", ctx);
    expect(statuses.every((status) => status === undefined)).toBe(true);
    events.get("session_shutdown")?.({ reason: "reload" }, ctx);
    expect(statuses.every((status) => status === undefined)).toBe(true);
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

  describe("Manual Advisor TUI modal", () => {
    const modalTheme = {
      bg: (_color: string, value: string) => value,
      bold: (value: string) => value,
      fg: (_color: string, value: string) => value,
    } as any;

    const makeHarness = (
      agentDir: string,
      state: AdvisorSessionState,
      drive: (dialog: any) => void,
      consult: (...args: any[]) => Promise<any>,
      mode: "rpc" | "tui" = "tui"
    ) => {
      const commands = new Map<string, any>();
      const events = new Map<string, any>();
      const entries: Array<{ data: unknown; type: string }> = [];
      const entryRenderers = new Map<string, any>();
      const modalOptions: any[] = [];
      const notices: string[] = [];
      const sent: Array<{ message: any; options: any }> = [];
      const statuses: Array<string | undefined> = [];
      const mockPi = {
        appendEntry(type: string, data: unknown) {
          entries.push({ data, type });
        },
        getActiveTools: () => [],
        on(event: string, handler: any) {
          events.set(event, handler);
        },
        registerCommand(name: string, config: any) {
          commands.set(name, config);
        },
        registerEntryRenderer(name: string, renderer: any) {
          entryRenderers.set(name, renderer);
        },
        sendMessage(message: any, options: any) {
          sent.push({ message, options });
        },
      } as unknown as ExtensionAPI;
      const ctx = {
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        mode,
        ui: {
          custom: (factory: any, options: any) =>
            new Promise((resolve) => {
              modalOptions.push(options);
              const dialog = factory(
                { requestRender: () => undefined, terminal: { rows: 24 } },
                modalTheme,
                getKeybindings(),
                resolve
              );
              dialog.focused = true;
              drive(dialog);
            }),
          notify: (message: string) => notices.push(message),
          setStatus: (key: string, value: string | undefined) => {
            if (key === "advisor-manual") {
              statuses.push(value);
            }
          },
        },
      } as any;
      registerCommands(mockPi, { consult, sessionState: state });
      return {
        commands,
        ctx,
        entries,
        entryRenderers,
        events,
        modalOptions,
        notices,
        sent,
        statuses,
      };
    };

    test("opens the centered overlay, edits its prefill, and forwards the selected Git level", async () => {
      await withManualConfig(
        { advisorGitContext: "full", advisorHerdrIntegration: false },
        async (agentDir) => {
          const state = new AdvisorSessionState();
          const calls: Array<{
            gitContext: GitContextLevel | undefined;
            question: string | undefined;
          }> = [];
          const harness = makeHarness(
            agentDir,
            state,
            (dialog) => {
              expect(dialog.render(100).join("\\n")).toContain("Check");
              dialog.handleInput(" ");
              for (const character of "migration") {
                dialog.handleInput(character);
              }
              dialog.handleInput(String.fromCharCode(13));
            },
            (_ctx, question, _signal, _onChunk, _onScout, gitContext) => {
              calls.push({ gitContext, question });
              return Promise.resolve({
                markdown: "Review complete.",
                thinkingText: "",
              });
            }
          );

          await harness.commands
            .get("advisor-manual")
            .handler("Check", harness.ctx);
          await new Promise((resolve) => setTimeout(resolve, 0));

          expect(harness.modalOptions).toHaveLength(1);
          expect(harness.modalOptions[0]).toMatchObject({
            overlay: true,
            overlayOptions: { anchor: "center" },
          });
          expect(calls).toEqual([
            { gitContext: "full", question: "Check migration" },
          ]);
          expect(state.consumedCalls).toBe(1);
          expect(harness.entries).toHaveLength(1);
          expect(harness.entries[0]?.type).toBe("advisor-manual-call");
          expect(harness.entries[0]?.data).toMatchObject({
            progressId: expect.any(String),
            question: "Check migration",
          });
          expect(harness.sent[0]?.message).toMatchObject({
            customType: "advisor-manual-result",
            details: { question: "Check migration" },
          });
        }
      );
    });

    test("renders the manual call and loading spinner before completion", async () => {
      await withManualConfig(
        { advisorGitContext: "summary", advisorHerdrIntegration: false },
        async (agentDir) => {
          const state = new AdvisorSessionState();
          let resolveConsult!: (result: {
            markdown: string;
            thinkingText: string;
          }) => void;
          const pending = new Promise<{
            markdown: string;
            thinkingText: string;
          }>((resolve) => {
            resolveConsult = resolve;
          });
          let onChunk: ((thinking: string, text: string) => void) | undefined;
          let onScout: ((event: any) => void) | undefined;
          const harness = makeHarness(
            agentDir,
            state,
            (dialog) => dialog.handleInput(String.fromCharCode(13)),
            (_ctx, _question, _signal, chunk, scout) => {
              onChunk = chunk;
              onScout = scout;
              return pending;
            }
          );

          await harness.commands.get("advisor-manual").handler("", harness.ctx);

          const [entry] = harness.entries;
          const renderer = harness.entryRenderers.get("advisor-manual-call");
          expect(entry).toBeDefined();
          expect(renderer).toBeDefined();
          const component = renderer(entry, { expanded: false }, modalTheme);
          const rendered = component.render(100).join("\\n");
          expect(rendered).toContain("Executor → Advisor");
          expect(rendered).toContain("◆ ADVISOR");
          expect(rendered).toContain("Preparing");

          onScout?.({ model: "provider/executor", type: "call" });
          const scoutRendered = component.render(100).join("\\n");
          expect(scoutRendered).toContain("◆ SCOUT");
          expect(scoutRendered).toContain("CURATING");
          onScout?.({
            outcome: {
              conversation: "selected evidence",
              metrics: {
                availableCount: 1,
                inputBytes: 1,
                latencyMs: 1,
                omittedBeforeScout: 0,
                selectedCount: 1,
              },
              model: "provider/executor",
              ok: true,
              selectedLabels: [],
              selection: { selectedIds: [], synthesis: "" },
            },
            type: "success",
          });
          onChunk?.("**Thinking**\n\n- check", "Partial answer");
          const advisorRendered = component.render(100).join("\\n");
          expect(advisorRendered).toContain("◆ ADVISOR");
          expect(advisorRendered).toContain("Partial answer");
          expect(advisorRendered).toContain("Thinking");
          expect(advisorRendered).not.toContain("**Thinking**");

          harness.events.get("session_shutdown")?.(undefined, harness.ctx);
          resolveConsult({ markdown: "Done.", thinkingText: "" });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      );
    });

    test("submits a blank general review and maps the None choice to off", async () => {
      await withManualConfig(
        { advisorGitContext: "full", advisorHerdrIntegration: false },
        async (agentDir) => {
          const state = new AdvisorSessionState();
          let received:
            | {
                gitContext: GitContextLevel | undefined;
                question: string | undefined;
              }
            | undefined;
          const harness = makeHarness(
            agentDir,
            state,
            (dialog) => {
              dialog.handleInput(String.fromCharCode(9));
              dialog.handleInput(`${String.fromCharCode(27)}[B`);
              dialog.handleInput(`${String.fromCharCode(27)}[B`);
              dialog.handleInput(String.fromCharCode(9));
              dialog.handleInput(String.fromCharCode(13));
            },
            (_ctx, question, _signal, _onChunk, _onScout, gitContext) => {
              received = { gitContext, question };
              return Promise.resolve({
                markdown: "General review.",
                thinkingText: "",
              });
            }
          );

          await harness.commands.get("advisor-manual").handler("", harness.ctx);
          await new Promise((resolve) => setTimeout(resolve, 0));

          expect(received).toEqual({ gitContext: "off", question: undefined });
          expect(harness.entries).toHaveLength(1);
          expect(harness.entries[0]?.data).toMatchObject({
            progressId: expect.any(String),
            question: undefined,
          });
        }
      );
    });

    test("cancels without consultation, budget use, transcript, or status side effects", async () => {
      await withManualConfig(
        { advisorGitContext: "summary", advisorHerdrIntegration: false },
        async (agentDir) => {
          const state = new AdvisorSessionState();
          let consultations = 0;
          const harness = makeHarness(
            agentDir,
            state,
            (dialog) => dialog.handleInput(String.fromCharCode(27)),
            () => {
              consultations += 1;
              return Promise.resolve({
                markdown: "Should not run.",
                thinkingText: "",
              });
            }
          );

          await harness.commands
            .get("advisor-manual")
            .handler("Check", harness.ctx);

          expect(consultations).toBe(0);
          expect(state.consumedCalls).toBe(0);
          expect(harness.entries).toEqual([]);
          expect(harness.sent).toEqual([]);
          expect(harness.statuses).toEqual([]);
          expect(harness.notices).toEqual([]);
        }
      );
    });

    test("rechecks the budget at Submit and leaves an active older consultation untouched on cancel", async () => {
      await withManualConfig(
        { advisorGitContext: "full", advisorHerdrIntegration: false },
        async (agentDir) => {
          const state = new AdvisorSessionState();
          const signals: AbortSignal[] = [];
          let modalCalls = 0;
          const harness = makeHarness(
            agentDir,
            state,
            (dialog) => {
              modalCalls += 1;
              if (modalCalls === 1) {
                dialog.handleInput(String.fromCharCode(13));
              } else {
                dialog.handleInput(String.fromCharCode(27));
              }
            },
            (_ctx, _question, signal) => {
              if (!signal) {
                throw new Error("Missing manual consultation signal.");
              }
              signals.push(signal);
              return new Promise(() => undefined);
            }
          );

          await harness.commands
            .get("advisor-manual")
            .handler("First", harness.ctx);
          const statusCountAfterFirst = harness.statuses.length;
          await harness.commands
            .get("advisor-manual")
            .handler("Second", harness.ctx);

          expect(signals).toHaveLength(1);
          expect(signals[0]?.aborted).toBe(false);
          expect(state.consumedCalls).toBe(1);
          expect(harness.entries).toHaveLength(1);
          expect(harness.statuses).toHaveLength(statusCountAfterFirst);

          harness.events.get("session_shutdown")?.(
            { reason: "reload" },
            harness.ctx
          );
        }
      );
    });

    test("rejects a Submit after the budget is consumed while the overlay is open", async () => {
      await withManualConfig(
        {
          advisorGitContext: "summary",
          advisorHerdrIntegration: false,
          advisorMaxCallsPerSession: 1,
        },
        async (agentDir) => {
          const state = new AdvisorSessionState();
          let consultations = 0;
          const harness = makeHarness(
            agentDir,
            state,
            (dialog) => {
              state.consumeCall();
              dialog.handleInput(String.fromCharCode(13));
            },
            () => {
              consultations += 1;
              return Promise.resolve({
                markdown: "Should not run.",
                thinkingText: "",
              });
            }
          );

          await harness.commands
            .get("advisor-manual")
            .handler("Check", harness.ctx);

          expect(consultations).toBe(0);
          expect(state.consumedCalls).toBe(1);
          expect(harness.entries).toEqual([]);
          expect(harness.sent).toEqual([]);
          expect(harness.statuses).toEqual([]);
          expect(harness.notices).toEqual([
            "Advisor call budget exhausted for this session.",
          ]);
        }
      );
    });

    test("aborts an older consultation only after a newer modal submission", async () => {
      await withManualConfig(
        { advisorGitContext: "full", advisorHerdrIntegration: false },
        async (agentDir) => {
          const state = new AdvisorSessionState();
          const signals: AbortSignal[] = [];
          const harness = makeHarness(
            agentDir,
            state,
            (dialog) => {
              dialog.handleInput(String.fromCharCode(13));
            },
            (_ctx, _question, signal) => {
              if (!signal) {
                throw new Error("Missing manual consultation signal.");
              }
              signals.push(signal);
              return new Promise(() => undefined);
            }
          );

          await harness.commands
            .get("advisor-manual")
            .handler("First", harness.ctx);
          await harness.commands
            .get("advisor-manual")
            .handler("Second", harness.ctx);

          expect(signals).toHaveLength(2);
          expect(signals[0]?.aborted).toBe(true);
          expect(signals[1]?.aborted).toBe(false);
          expect(state.consumedCalls).toBe(2);

          harness.events.get("session_shutdown")?.(
            { reason: "reload" },
            harness.ctx
          );
        }
      );
    });

    test("keeps the backend clamp effective when the modal selection becomes stale", async () => {
      await withManualConfig(
        { advisorGitContext: "full", advisorHerdrIntegration: false },
        async (agentDir) => {
          const state = new AdvisorSessionState();
          let requested: GitContextLevel | undefined;
          let effective: GitContextLevel | undefined;
          const harness = makeHarness(
            agentDir,
            state,
            (dialog) => {
              writeFileSync(
                join(agentDir, "advisor.json"),
                JSON.stringify({
                  advisorGitContext: "summary",
                  advisorHerdrIntegration: false,
                })
              );
              resetConfigCache();
              dialog.handleInput(String.fromCharCode(13));
            },
            (ctx, _question, _signal, _onChunk, _onScout, gitContext) => {
              loadConfig(ctx);
              const allowed = getAdvisorSettings().gitContext;
              requested = gitContext;
              effective = clampGitContextLevel(gitContext ?? allowed, allowed);
              return Promise.resolve({
                markdown: "Clamped review.",
                thinkingText: "",
              });
            }
          );

          await harness.commands
            .get("advisor-manual")
            .handler("Check", harness.ctx);
          await new Promise((resolve) => setTimeout(resolve, 0));

          expect(requested).toBe("full");
          expect(effective).toBe("summary");
        }
      );
    });

    test("keeps RPC invocation immediate and does not call the TUI overlay", async () => {
      await withManualConfig(
        { advisorGitContext: "summary", advisorHerdrIntegration: false },
        async (agentDir) => {
          const state = new AdvisorSessionState();
          let receivedQuestion: string | undefined;
          const harness = makeHarness(
            agentDir,
            state,
            () => {
              throw new Error("RPC must not open the TUI overlay.");
            },
            (_ctx, question, _signal, _onChunk, _onScout, gitContext) => {
              receivedQuestion = question;
              expect(gitContext).toBeUndefined();
              return Promise.resolve({
                markdown: "RPC review.",
                thinkingText: "",
              });
            },
            "rpc"
          );

          await harness.commands
            .get("advisor-manual")
            .handler("RPC focus", harness.ctx);
          await new Promise((resolve) => setTimeout(resolve, 0));

          expect(harness.modalOptions).toEqual([]);
          expect(receivedQuestion).toBe("RPC focus");
          expect(state.consumedCalls).toBe(1);
        }
      );
    });
  });

  test("distinguishes the executor request from the advisor response", () => {
    setShowUsageDetailsRef(true);
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
    expect(advisorTool.parameters.properties.includeTrackedFiles).toBeDefined();

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
          details: {
            advisor: "test/model",
            text: "**Ship it.**",
            usage: { cacheRead: 20, cost: 0.0123, input: 1200, output: 456 },
          },
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
    expect(response).toContain("Usage: ↑1.2k · ↓456 · cr:20 · $0.0123");
    expect(response).toContain("Ship it.");
    expect(response).not.toContain("**Ship it.**");
    expect(response).not.toContain("Advisor (test/model)");

    setShowUsageDetailsRef(false);
    try {
      const hiddenUsage = advisorTool
        .renderResult(
          {
            content: [
              { text: "Advisor (test/model)\n\n**Ship it.**", type: "text" },
            ],
            details: {
              advisor: "test/model",
              text: "**Ship it.**",
              usage: {
                cacheRead: 20,
                cost: 0.0123,
                input: 1200,
                output: 456,
              },
            },
          },
          { isPartial: false },
          theme,
          context
        )
        .render(120)
        .join("\n");
      expect(hiddenUsage).not.toContain("Usage:");
    } finally {
      setShowUsageDetailsRef(true);
    }

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
    expect(advisorTool.promptGuidelines.join(" ")).toContain(
      "sequential follow-up"
    );
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

  test("applies redaction at the Advisor request-context boundary", () => {
    const secret = "AKIAABCDEFGHIJKLMNOP";
    const ctx = {
      sessionManager: {
        getBranch: () => [
          {
            message: { content: `api_key=${secret}`, role: "user" },
            type: "message",
          },
          {
            message: {
              content: secret,
              role: "toolResult",
              toolName: "custom",
            },
            type: "message",
          },
        ],
      },
    } as any;
    setAdvisorRedactSecretsRef(true);
    setAdvisorToolPoliciesRef({});
    try {
      const context = advisorRequestConversation(ctx);
      expect(context).not.toContain(secret);
      expect(context).toContain("[REDACTED SECRET]");
    } finally {
      setAdvisorRedactSecretsRef(false);
      setAdvisorToolPoliciesRef({});
    }
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

  test("uses a compact searchable settings list and saves each change", () => {
    const saved: any[] = [];
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
      onChange: (settings) => saved.push(settings),
      presets: [
        { description: "No history", label: "0", value: 0 },
        { description: "Recent history", label: "10k", value: 10_000 },
      ],
      theme: {
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
      } as any,
      tui: { requestRender: () => undefined },
    });
    const screen = selector.render(80).join("\n");
    expect(screen).toContain("Advisor reasoning");
    expect(screen).toContain("Experimental Advisor Scout");
    expect(screen).toContain("Show usage and cost details");
    expect(screen).not.toContain("Save changes");
    expect(screen).toContain("Type to search");

    changeSetting(selector, "Context window");
    changeSetting(selector, "Show usage and cost details");
    expect(saved.at(-1)).toMatchObject({
      contextMaxChars: 10_000,
      showUsageDetails: false,
    });

    for (const key of ["s", "e", "c", "r", "e", "t"]) {
      selector.handleInput(key);
    }
    expect(selector.render(100).join("\n")).toContain("Redact common secrets");
  });

  test("uses arrow keys to change the selected setting", () => {
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
      onChange: (settings) => {
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
      tui: { requestRender: () => undefined },
    });
    selector.handleInput("\u001b[C");
    expect(saved.contextMaxChars).toBe(10_000);
    selector.handleInput("\u001b[D");
    expect(saved.contextMaxChars).toBe(0);
  });

  test("uses Space to toggle and auto-save a setting", () => {
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
      onChange: (settings) => {
        saved = settings;
      },
      presets: [{ description: "No history", label: "0", value: 0 }],
      theme: {
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
      } as any,
      tui: { requestRender: () => undefined },
    });
    focusSettingsRow(selector, "Always on");
    selector.handleInput(" ");
    expect(saved.alwaysOn).toBe(true);
  });

  test("renders a context depth meter", () => {
    const selector = new AdvisorSettingsSelector({
      effortLevels: ["Default (Model Default)"],
      initial: {
        collapseResponses: false,
        completionGate: true,
        contextMaxChars: Number.MAX_SAFE_INTEGER,
        failureGate: true,
        planGate: true,
      },
      onCancel: () => undefined,
      onChange: () => undefined,
      presets: [
        { description: "No history", label: "0", value: 0 },
        {
          description: "Full branch",
          label: "ALL",
          value: Number.MAX_SAFE_INTEGER,
        },
      ],
      theme: {
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
      } as any,
      tui: { requestRender: () => undefined },
    });
    const screen = selector.render(100).join("\n").replace(SGR_CODE, "");
    const lines = screen.split("\n");
    const meterLine = lines.find((line) => line.includes("none"));
    const labelLine = lines.find((line) => line.trim() === "ALL");
    if (!(meterLine && labelLine)) {
      throw new Error("Context meter did not render its marker and label");
    }
    expect(meterLine).toContain("full");
    expect(meterLine).toContain("●");
    expect(labelLine.indexOf("ALL")).toBe(meterLine.indexOf("●") - 1);
    expect(screen).not.toContain("████");
  });

  test("restores Simple mode animation", () => {
    const selector = new AdvisorSettingsSelector({
      effortLevels: ["Default (Model Default)"],
      initial: {
        collapseResponses: false,
        completionGate: true,
        contextMaxChars: 0,
        failureGate: true,
        planGate: true,
        simpleMode: true,
      },
      onCancel: () => undefined,
      onChange: () => undefined,
      presets: [{ description: "No history", label: "0", value: 0 }],
      theme: {
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
      } as any,
      tui: { requestRender: () => undefined },
    });
    expect(selector.render(100).join("\n")).toContain("\u001b[38;2;");
    selector.dispose();
  });

  test("hides Scout in Simple mode without losing its saved value", () => {
    let saved: any;
    const selector = new AdvisorSettingsSelector({
      effortLevels: ["Default (Model Default)"],
      initial: {
        collapseResponses: false,
        completionGate: true,
        contextMaxChars: 0,
        failureGate: true,
        planGate: true,
        scoutEnabled: true,
        simpleMode: true,
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
      tui: { requestRender: () => undefined },
    });
    expect(selector.render(100).join("\n")).not.toContain(
      "Experimental Advisor Scout"
    );
    changeSetting(selector, "Simple mode");
    expect(stripTerminalSequences(selector.render(100).join("\n"))).toMatch(
      SCOUT_ON_PATTERN
    );
    expect(saved.scoutEnabled).toBe(true);
    selector.dispose();
  });

  test("preserves explicit privacy settings through the selector", () => {
    let saved: any;
    const selector = new AdvisorSettingsSelector({
      effortLevels: ["Default (Model Default)"],
      initial: {
        collapseResponses: false,
        completionGate: true,
        contextMaxChars: 0,
        failureGate: true,
        planGate: true,
        redactSecrets: true,
        toolPolicies: { bash: "summary", deploy: "exclude" },
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
      tui: { requestRender: () => undefined },
    });
    changeSetting(selector, "Simple mode");
    expect(saved).toMatchObject({
      redactSecrets: true,
      toolPolicies: { bash: "summary", deploy: "exclude" },
    });
  });

  test("keeps invalid tool disclosure policies open with an actionable error", () => {
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
      onSave: () => undefined,
      presets: [{ description: "No history", label: "0", value: 0 }],
      theme: {
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
      } as any,
      tui: { requestRender: () => undefined },
    });
    focusSettingsRow(selector, "Tool disclosure policies");
    selector.handleInput("\r");
    const editor = (selector as any).settingsList.submenuComponent;
    editor.input.onSubmit('{"bash":"invalid"}');
    expect(selector.render(120).join("\n")).toContain(
      "Use non-empty tool names with full, summary, or exclude values."
    );
    editor.input.onSubmit("{");
    expect(selector.render(120).join("\n")).toContain(
      "Enter a valid JSON object."
    );
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
    focusSettingsRow(selector, "Custom invocation");
    selector.handleInput("\r");
    selector.handleInput("d");
    selector.handleInput("e");
    selector.handleInput("p");
    selector.handleInput("l");
    selector.handleInput("o");
    selector.handleInput("y");
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
        focusSettingsRow(selector, "Experimental Advisor Scout");
        changeSetting(selector, "Experimental Advisor Scout");
        changeSetting(selector, "Max Advisor calls/session");
        selector.handleInput("\u001b");
      });
    const reopened = async (factory: any) =>
      new Promise<any>((resolve) => {
        const selector = factory(
          { requestRender: () => undefined },
          theme,
          {},
          resolve
        );
        const initialScreen = stripTerminalSequences(
          selector.render(100).join("\n")
        );
        expect(initialScreen).toMatch(SCOUT_ON_PATTERN);
        for (const key of ["m", "a", "x"]) {
          selector.handleInput(key);
        }
        const screen = stripTerminalSequences(selector.render(100).join("\n"));
        expect(screen).toMatch(MAX_CALLS_ROW_PATTERN);
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
      ui: { custom, notify: () => undefined, setStatus: () => undefined },
    } as any;

    try {
      registerCommands(mockPi);
      await commands.get("advisor-settings").handler("", context);
      expect(
        JSON.parse(readFileSync(join(agentDir, "advisor.json"), "utf8"))
      ).toMatchObject({
        advisorMaxCallsPerSession: 10,
        advisorScoutEnabled: true,
      });
      expect(advisorScoutEnabledRef).toBe(true);
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

  test("renders the shared expanded Scout fallback entry", () => {
    setShowUsageDetailsRef(true);
    const renderers = new Map<string, any>();
    const mockPi = {
      getActiveTools: () => [],
      on: () => undefined,
      registerCommand: () => undefined,
      registerEntryRenderer(type: string, renderer: any) {
        renderers.set(type, renderer);
      },
      registerTool: () => undefined,
    } as unknown as ExtensionAPI;
    registerExtension(mockPi);
    const theme = {
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    };
    const fallback = renderers
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
      const hiddenUsage = renderers
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

  test("renders Scout phases before Advisor and clears timers at transitions", () => {
    let advisorTool: any;
    const mockPi = {
      getActiveTools: () => [],
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

  test("renders incomplete thinking Markdown within narrow widths", () => {
    const theme = {
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    };
    const component = renderThinkingMarkdown(
      "**Reviewing\n\n```ts\nconst next = 1",
      theme
    );
    const rendered = component.render(24);
    const plain = rendered.map(stripTerminalSequences).join("\n");

    expect(rendered.length).toBeGreaterThan(0);
    expect(plain).toContain("Reviewing");
    expect(plain).toContain("const next");
    expect(plain).toContain("💭");
    expect(
      rendered.every((line) => visibleWidth(stripTerminalSequences(line)) <= 24)
    ).toBe(true);
  });

  test("accepts transient incomplete Markdown during streaming", () => {
    const theme = {
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    };
    const incomplete = renderThinkingMarkdown("**Incomplete bold", theme);
    const plain = incomplete.render(80).map(stripTerminalSequences).join("\n");

    // During streaming, raw markers appear transiently (expected behavior).
    // When thinking completes, they will render properly.
    expect(plain).toContain("💭");
    expect(plain).toContain("Incomplete bold");
  });

  test("renders completed Markdown thinking without raw markers", () => {
    const theme = {
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    };
    const complete = renderThinkingMarkdown("**Completed bold**", theme);
    const plain = complete.render(80).map(stripTerminalSequences).join("\n");

    expect(plain).toContain("💭");
    expect(plain).toContain("Completed bold");
    // Once delimiters close, markers don't appear
    expect(plain).not.toContain("**Completed");
  });

  test("renders automatic-gate Scout fallback before the unaffected Advisor gate", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({ advisorLoopThreshold: 2, advisorScoutEnabled: true })
    );
    resetConfigCache();
    const events = new Map<string, any>();
    const timeline: string[] = [];
    const sentMessages: any[] = [];
    const invocationIds: unknown[] = [];
    const mockPi = {
      appendEntry(type: string) {
        timeline.push(`entry:${type}`);
      },
      getActiveTools: () => ["ask_advisor"],
      on(name: string, handler: any) {
        events.set(name, handler);
      },
      registerEntryRenderer: () => undefined,
      registerMessageRenderer: () => undefined,
      registerTool: () => undefined,
      sendMessage(message: any) {
        sentMessages.push(message);
        timeline.push(`message:${message.customType}`);
      },
    } as unknown as ExtensionAPI;
    const session = new AdvisorSessionState();
    registerAdvisorTool(mockPi, session, {
      runGate: (async (
        _ctx: unknown,
        _question: string,
        _trigger: string,
        _signal: AbortSignal | undefined,
        _onChunk: unknown,
        onScout: any,
        currentInvocationId: unknown
      ) => {
        invocationIds.push(currentInvocationId);
        await Promise.resolve();
        onScout?.({ model: "provider/executor", type: "call" });
        onScout?.({
          outcome: {
            category: "timeout",
            message: "Scout timed out after 30000 ms.",
            metrics: {
              availableCount: 2,
              inputBytes: 20,
              latencyMs: 30_000,
              omittedBeforeScout: 0,
              selectedCount: 0,
            },
            model: "provider/executor",
            ok: false,
          },
          type: "fallback",
        });
        return {
          decision: "proceed",
          markdown: "Decision: proceed",
          model: "provider/advisor",
          ok: true,
          thinkingText: "",
          trigger: "repeated-tool-call",
          usage: {
            cacheRead: 4,
            cost: { total: 0.02 },
            input: 100,
            output: 20,
          },
        };
      }) as any,
    });
    const ctx = {
      cwd: agentDir,
      hasUI: false,
      isProjectTrusted: () => false,
      signal: new AbortController().signal,
    } as any;
    try {
      await events.get("tool_call")?.(
        { input: { command: "pwd" }, toolCallId: "one", toolName: "bash" },
        ctx
      );
      await events.get("tool_call")?.(
        { input: { command: "pwd" }, toolCallId: "two", toolName: "bash" },
        ctx
      );
      expect(timeline).toEqual([
        "entry:advisor-scout-result",
        "message:advisor-loop-call",
        "message:advisor-loop-result",
      ]);
      expect(session.blocked).toBe(false);
      expect(invocationIds).toEqual(["two"]);
      expect(sentMessages.at(-1).details.usage).toEqual({
        cacheRead: 4,
        cost: 0.02,
        input: 100,
        output: 20,
      });
      expect(session.usageStatus()).toContain("$0.0200");
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("preserves Scout cancellation across the final thrown-tool render", () => {
    let advisorTool: any;
    const mockPi = {
      getActiveTools: () => [],
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

describe("Advisor activation and mode regressions", () => {
  const plainTheme = {
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  } as any;

  const withAgentDir = async (
    initial: Record<string, unknown>,
    run: (agentDir: string) => Promise<void> | void
  ) => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify(initial, null, 2)
    );
    resetConfigCache();
    try {
      await run(agentDir);
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  };

  const harness = () => {
    const commands = new Map<string, any>();
    const events = new Map<string, (event: any, ctx: any) => any>();
    const renderers = new Map<string, any>();
    let activeTools: string[] = ["ask_advisor"];
    const pi = {
      appendEntry: () => undefined,
      getActiveTools: () => activeTools,
      on(event: string, handler: any) {
        events.set(event, handler);
      },
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      registerEntryRenderer: () => undefined,
      registerMessageRenderer(type: string, renderer: any) {
        renderers.set(type, renderer);
      },
      registerTool: () => undefined,
      sendMessage: () => undefined,
      setActiveTools(tools: string[]) {
        activeTools = tools;
      },
      setModel: () => Promise.resolve(true),
      setThinkingLevel: () => undefined,
    } as unknown as ExtensionAPI;
    return {
      commands,
      events,
      pi,
      renderers,
      setActiveTools: (tools: string[]) => {
        activeTools = tools;
      },
    };
  };

  const context = (agentDir: string, notes: string[] = []) =>
    ({
      cwd: agentDir,
      hasUI: true,
      isProjectTrusted: () => false,
      modelRegistry: {
        find: (provider: string, id: string) => ({ id, provider }),
        getApiKeyAndHeaders: () => Promise.resolve({ apiKey: "key", ok: true }),
      },
      ui: { notify: (message: string) => notes.push(message) },
    }) as any;

  const savedConfig = (agentDir: string) =>
    JSON.parse(readFileSync(join(agentDir, "advisor.json"), "utf8"));

  test("only an explicit model selection redefines the persisted Executor", async () => {
    await withAgentDir(
      { executor: "configured/executor" },
      async (agentDir) => {
        const { events, pi } = harness();
        registerCommands(pi);
        const ctx = context(agentDir);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        for (const source of ["restore", "cycle"] as const) {
          events.get("model_select")?.(
            { model: { id: "other", provider: "vendor" }, source },
            ctx
          );
          expect(savedConfig(agentDir).executor).toBe("configured/executor");
        }

        events.get("model_select")?.(
          { model: { id: "chosen", provider: "vendor" }, source: "set" },
          ctx
        );
        expect(savedConfig(agentDir).executor).toBe("vendor/chosen");
      }
    );
  });

  test("uses models selected in advisor-models when activating in the same session", async () => {
    await withAgentDir({}, async (agentDir) => {
      const commands = new Map<string, any>();
      let activeTools: string[] = [];
      let selectedModel: unknown;
      let customCall = 0;
      const pi = {
        getActiveTools: () => activeTools,
        on: () => undefined,
        registerCommand(name: string, config: any) {
          commands.set(name, config);
        },
        setActiveTools(tools: string[]) {
          activeTools = tools;
        },
        setModel(model: unknown) {
          selectedModel = model;
          return Promise.resolve(true);
        },
        setThinkingLevel: () => undefined,
      } as unknown as ExtensionAPI;
      const models = [
        { id: "executor", provider: "provider" },
        { id: "advisor", provider: "provider" },
      ];
      const theme = {
        bold: (value: string) => value,
        fg: (_color: string, value: string) => value,
      } as any;
      const ctx = {
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: {
          find: (provider: string, id: string) =>
            models.find(
              (model) => model.provider === provider && model.id === id
            ),
          getApiKeyAndHeaders: () =>
            Promise.resolve({ apiKey: "key", ok: true }),
          getAvailable: () => models,
        },
        ui: {
          custom: (factory: any) =>
            new Promise((resolve) => {
              const selector = factory(
                { requestRender: () => undefined },
                theme,
                { matches: () => false },
                resolve
              );
              selector.render(100);
              if (customCall === 1) {
                for (const character of "advisor") {
                  selector.handleInput(character);
                }
                selector.render(100);
              }
              customCall += 1;
              selector.handleInput("\r");
            }),
          notify: () => undefined,
          select: () => Promise.resolve("✓ Default (Model Default)"),
        },
      } as any;

      registerCommands(pi);
      await commands.get("advisor-models").handler("", ctx);
      expect(savedConfig(agentDir)).toMatchObject({
        advisor: "provider/advisor",
        executor: "provider/executor",
      });

      await commands.get("advisor").handler("", ctx);
      expect(selectedModel).toMatchObject({
        id: "executor",
        provider: "provider",
      });
      expect(activeTools).toContain("ask_advisor");
    });
  });

  test("preselects an inactive /model choice in advisor-models", async () => {
    await withAgentDir(
      { advisor: "provider/sonnet", executor: "provider/sonnet" },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = harness();
        const models = [
          { id: "sonnet", provider: "provider" },
          { id: "luna", provider: "provider" },
        ];
        const selectedModels: string[] = [];
        let customCall = 0;
        const theme = {
          bold: (value: string) => value,
          fg: (_color: string, value: string) => value,
        } as any;
        const ctx = {
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry: {
            find: (provider: string, id: string) =>
              models.find(
                (model) => model.provider === provider && model.id === id
              ),
            getApiKeyAndHeaders: () =>
              Promise.resolve({ apiKey: "key", ok: true }),
            getAvailable: () => models,
          },
          ui: {
            custom: (factory: any) =>
              new Promise((resolve) => {
                const selector = factory(
                  { requestRender: () => undefined },
                  theme,
                  { matches: () => false },
                  (value: string | undefined) => {
                    if (value) {
                      selectedModels.push(value);
                    }
                    resolve(value);
                  }
                );
                selector.render(100);
                if (customCall === 1) {
                  for (const character of "luna") {
                    selector.handleInput(character);
                  }
                  selector.render(100);
                }
                customCall += 1;
                selector.handleInput("\r");
              }),
            notify: () => undefined,
            select: () => Promise.resolve("✓ Default (Model Default)"),
          },
        } as any;

        registerCommands(pi);
        setActiveTools([]);
        await events.get("session_start")?.({ reason: "startup" }, ctx);
        events.get("model_select")?.(
          { model: { id: "luna", provider: "provider" }, source: "set" },
          ctx
        );

        await commands.get("advisor-models").handler("", ctx);
        await commands.get("advisor").handler("", ctx);

        expect(selectedModels).toEqual(["provider/luna", "provider/luna"]);
        expect(savedConfig(agentDir)).toMatchObject({
          advisor: "provider/luna",
          executor: "provider/luna",
        });
      }
    );
  });

  test("adopts an explicit model selection made before activation", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", executor: "configured/executor" },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = harness();
        registerCommands(pi);
        setActiveTools([]);
        const ctx = context(agentDir);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        events.get("model_select")?.(
          { model: { id: "luna", provider: "provider" }, source: "set" },
          ctx
        );
        // Keep normal `/model` changes out of global config until activation
        // succeeds.
        expect(savedConfig(agentDir).executor).toBe("configured/executor");

        await commands.get("advisor").handler("", ctx);

        expect(savedConfig(agentDir)).toMatchObject({
          advisor: "provider/advisor",
          executor: "provider/luna",
        });
        expect(pi.getActiveTools()).toContain("ask_advisor");
      }
    );
  });

  test("an explicit /advisor Executor override wins over an inactive selection", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", executor: "configured/executor" },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = harness();
        registerCommands(pi);
        setActiveTools([]);
        const ctx = context(agentDir);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        events.get("model_select")?.(
          { model: { id: "luna", provider: "provider" }, source: "set" },
          ctx
        );
        await commands
          .get("advisor")
          .handler("executor=provider/explicit", ctx);

        expect(savedConfig(agentDir).executor).toBe("provider/explicit");
      }
    );
  });

  test("does not adopt restored or cycled models on activation", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", executor: "configured/executor" },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = harness();
        registerCommands(pi);
        setActiveTools([]);
        const ctx = context(agentDir);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        for (const source of ["restore", "cycle"] as const) {
          events.get("model_select")?.(
            { model: { id: "other", provider: "provider" }, source },
            ctx
          );
        }
        await commands.get("advisor").handler("", ctx);

        expect(savedConfig(agentDir).executor).toBe("configured/executor");
        expect(pi.getActiveTools()).toContain("ask_advisor");
      }
    );
  });

  test("keeps an inactive model selection out of config until activation", async () => {
    await withAgentDir({ executor: "configured/executor" }, (agentDir) => {
      const { events, pi, setActiveTools } = harness();
      registerCommands(pi);
      setActiveTools([]);
      events.get("model_select")?.(
        { model: { id: "chosen", provider: "vendor" }, source: "set" },
        context(agentDir)
      );
      expect(savedConfig(agentDir).executor).toBe("configured/executor");
    });
  });

  test("reports rather than throws when always-on activation fails", async () => {
    await withAgentDir({ alwaysOn: true }, async (agentDir) => {
      writeFileSync(join(agentDir, "advisor.json"), "{ not json");
      resetConfigCache();
      const { events, pi } = harness();
      registerCommands(pi);
      const notes: string[] = [];
      await events.get("session_start")?.(
        { reason: "startup" },
        context(agentDir, notes)
      );
      expect(notes.join("\n")).toContain("Advisor activation failed");
    });
  });

  test("activates silently for always-on sessions but announces /advisor", async () => {
    await withAgentDir({ alwaysOn: true }, async (agentDir) => {
      const { commands, events, pi, setActiveTools } = harness();
      registerCommands(pi);
      const automatic: string[] = [];
      setActiveTools([]);
      await events.get("session_start")?.(
        { reason: "startup" },
        context(agentDir, automatic)
      );
      expect(automatic).toEqual([]);
      expect(pi.getActiveTools()).toContain("ask_advisor");

      const manual: string[] = [];
      await commands.get("advisor").handler("", context(agentDir, manual));
      expect(manual.join("\n")).toContain("Advisor flow ready");
    });
  });

  test("hides usage details from automatic gate results when disabled", () => {
    setShowUsageDetailsRef(true);
    const { pi, renderers } = harness();
    registerAdvisorTool(pi);
    const render = () =>
      renderers
        .get("advisor-loop-result")(
          {
            content: [{ text: "Decision: proceed", type: "text" }],
            details: {
              advisor: "test/model",
              decision: "proceed",
              text: "Decision: proceed",
              usage: { cost: 0.0042, input: 50, output: 10 },
            },
          },
          { expanded: false },
          plainTheme
        )
        .render(120)
        .join("\n");

    expect(render()).toContain("Usage: ↑50 · ↓10 · $0.0042");
    setShowUsageDetailsRef(false);
    try {
      expect(render()).not.toContain("Usage:");
    } finally {
      setShowUsageDetailsRef(true);
    }
  });

  test("turning the Advisor off also clears persistent activation", async () => {
    await withAgentDir({ alwaysOn: true }, async (agentDir) => {
      const { commands, events, pi } = harness();
      registerCommands(pi);
      const notes: string[] = [];
      const ctx = context(agentDir, notes);
      await events.get("session_start")?.({ reason: "startup" }, ctx);

      await commands.get("advisor-off").handler("", ctx);
      expect(pi.getActiveTools()).not.toContain("ask_advisor");
      expect(savedConfig(agentDir).alwaysOn).toBe(false);
      expect(notes.at(-1)).toContain("Always on turned off");
    });
  });

  test("persists context arguments supplied to /advisor", async () => {
    await withAgentDir({ contextMaxChars: 15_000 }, async (agentDir) => {
      const { commands, pi } = harness();
      registerCommands(pi);
      await commands
        .get("advisor")
        .handler("contextMaxChars=5000", context(agentDir));
      expect(savedConfig(agentDir).contextMaxChars).toBe(5000);
      expect(loadConfig(context(agentDir))).toBeTruthy();
      expect(contextMaxCharsRef).toBe(5000);
    });
  });

  test("renders a manual sound verdict exactly like the tool response", async () => {
    await withAgentDir({}, () => {
      const { pi, renderers } = harness();
      registerCommands(pi);
      const render = (text: string) =>
        renderers
          .get("advisor-manual-result")(
            {
              content: text,
              details: {
                advisor: "test/model",
                text,
                usage: { cacheWrite: 3, cost: 0.01, input: 100, output: 20 },
              },
            },
            { expanded: true },
            plainTheme
          )
          .render(120)
          .join("\n");
      expect(render("Verdict: sound\n\nNothing to change.")).toContain(
        "◆ ADVISOR · SOUND"
      );
      expect(render("Verdict: sound\n\nNothing to change.")).toContain(
        "Usage: ↑100 · ↓20 · cw:3 · $0.0100"
      );
      setShowUsageDetailsRef(false);
      try {
        expect(render("Verdict: sound\n\nNothing to change.")).not.toContain(
          "Usage:"
        );
      } finally {
        setShowUsageDetailsRef(true);
      }
      expect(render("Consider reverting the migration.")).toContain(
        "◆ ADVISOR RESPONSE"
      );
    });
  });
});

describe("Advisor settings navigation and gate parsing regressions", () => {
  const selectorTheme = {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  } as any;

  // The Simple mode row animates a per-character gradient while enabled.
  const plain = (selector: any) =>
    selector.render(100).join("\n").replace(SGR_CODE, "");

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
    const before = plain(selector);
    expect(before).toContain("→ Context window");
    expect(before).toContain("10k");
    expect(before.match(CONTEXT_WINDOW)).toHaveLength(1);
    changeSetting(selector, "Context window");
    expect(plain(selector)).toContain("15k");
  });

  test("filters advanced controls while Simple mode is enabled", () => {
    const { selector } = openSelector({
      contextMaxChars: 10_000,
      simpleMode: false,
    });
    changeSetting(selector, "Simple mode");
    expect(plain(selector)).toMatch(SIMPLE_MODE_ON);
    expect(plain(selector)).not.toContain("Plan gate");
    changeSetting(selector, "Simple mode");
    expect(plain(selector)).toMatch(SIMPLE_MODE_OFF);
    expect(plain(selector)).toContain("Plan gate");
  });

  test("keeps simple-mode settings visible after reopening", () => {
    const { selector } = openSelector({
      alwaysOn: false,
      simpleMode: true,
    });
    const screen = plain(selector);
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

  test("applies the configured policy to a blocked automatic gate decision", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const configPath = join(agentDir, "advisor.json");
    const results: Record<
      string,
      { aborted: boolean; blocked: boolean; result: unknown }
    > = {};

    try {
      for (const mode of [
        "block-session",
        "block-tool",
        "warn-and-continue",
      ] as const) {
        writeFileSync(
          configPath,
          JSON.stringify({
            advisorHerdrIntegration: false,
            advisorLoopThreshold: 2,
            gateFailureMode: mode,
          })
        );
        resetConfigCache();
        const state = new AdvisorSessionState();
        let toolCall: any;
        let aborted = false;
        const mockPi = {
          getActiveTools: () => ["ask_advisor"],
          on(event: string, handler: any) {
            if (event === "tool_call") {
              toolCall = handler;
            }
          },
          registerEntryRenderer: () => undefined,
          registerMessageRenderer: () => undefined,
          registerTool: () => undefined,
          sendMessage: () => undefined,
        } as unknown as ExtensionAPI;
        registerAdvisorTool(mockPi, state, {
          runGate: async () => ({
            decision: "blocked",
            markdown: "Decision: blocked\nStop here.",
            model: "provider/advisor",
            ok: true as const,
            thinkingText: "",
            trigger: "repeated-tool-call" as const,
          }),
        });
        const ctx = {
          abort: () => {
            aborted = true;
          },
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          signal: new AbortController().signal,
          ui: {
            notify: () => undefined,
            setStatus: () => undefined,
          },
        } as any;
        // The modes share the process-global configuration refs, so each case
        // must finish before the next one rewrites its configuration.
        // biome-ignore lint/performance/noAwaitInLoops: table-driven cases intentionally run sequentially.
        await toolCall(
          {
            input: { command: "pwd" },
            toolCallId: `${mode}-1`,
            toolName: "bash",
          },
          ctx
        );
        const result = await toolCall(
          {
            input: { command: "pwd" },
            toolCallId: `${mode}-2`,
            toolName: "bash",
          },
          ctx
        );
        results[mode] = { aborted, blocked: state.blocked, result };
      }

      expect(results["block-session"]).toMatchObject({
        aborted: true,
        blocked: true,
        result: { block: true },
      });
      expect(results["block-tool"]).toMatchObject({
        aborted: false,
        blocked: false,
        result: { block: true },
      });
      expect(results["warn-and-continue"]).toMatchObject({
        aborted: false,
        blocked: false,
      });
      expect(results["warn-and-continue"].result).toBeUndefined();
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("allows an outcome persistence failure to be retried", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({ advisorOutcomeLogging: true })
    );
    resetConfigCache();
    const state = new AdvisorSessionState();
    const tools = new Map<string, any>();
    let fail = true;
    const mockPi = {
      getActiveTools: () => [],
      on: () => undefined,
      registerEntryRenderer: () => undefined,
      registerMessageRenderer: () => undefined,
      registerTool(tool: any) {
        tools.set(tool.name, tool);
      },
    } as unknown as ExtensionAPI;

    state.issueAdvice(
      "advice-1",
      "Review the migration.",
      "executor-requested"
    );
    try {
      registerAdvisorTool(mockPi, state, {
        appendOutcome: (() =>
          fail
            ? Promise.reject(new Error("disk full"))
            : Promise.resolve()) as any,
      });
      const recordOutcome = tools.get("record_advisor_outcome");
      const params = {
        adoption: "followed",
        adviceId: "advice-1",
        validationStatus: "passed",
      };

      const first = await recordOutcome.execute(
        "outcome-1",
        params,
        undefined,
        undefined,
        { cwd: agentDir, hasUI: false, isProjectTrusted: () => false }
      );
      expect(first.details).toEqual({ recorded: false });
      expect(state.reserveAdvice("advice-1")).toBeDefined();
      state.releaseAdvice("advice-1");

      fail = false;
      const second = await recordOutcome.execute(
        "outcome-2",
        params,
        undefined,
        undefined,
        { cwd: agentDir, hasUI: false, isProjectTrusted: () => false }
      );
      expect(second.details).toEqual({ recorded: true });
      expect(state.reserveAdvice("advice-1")).toBeUndefined();

      await expect(
        recordOutcome.execute("outcome-3", params, undefined, undefined, {
          cwd: agentDir,
          hasUI: false,
          isProjectTrusted: () => false,
        })
      ).rejects.toThrow("Unknown, already recorded, or pending adviceId.");
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("keeps concurrent registrations' safety state isolated", () => {
    const firstState = new AdvisorSessionState();
    const secondState = new AdvisorSessionState();
    const firstStarts: Array<() => void> = [];
    const secondStarts: Array<() => void> = [];
    const makePi = (starts: Array<() => void>) =>
      ({
        getActiveTools: () => [],
        on(event: string, handler: any) {
          if (event === "session_start") {
            starts.push(handler);
          }
        },
        registerMessageRenderer: () => undefined,
        registerTool: () => undefined,
      }) as unknown as ExtensionAPI;

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
    const mockPi = {
      events: { emit: () => undefined },
      getActiveTools: () => [],
      on(event: string, handler: any) {
        if (event === "tool_call") {
          toolCall = handler;
        }
      },
      registerCommand: () => undefined,
      registerMessageRenderer: () => undefined,
      registerTool: () => undefined,
    } as unknown as ExtensionAPI;
    registerAdvisorTool(mockPi);
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

  test("uses the live unlimited budget after a finite config reload", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({ advisorMaxCallsPerSession: 1 })
    );
    resetConfigCache();
    let toolCall: any;
    const mockPi = {
      getActiveTools: () => ["ask_advisor"],
      on(event: string, handler: any) {
        if (event === "tool_call") {
          toolCall = handler;
        }
      },
      registerEntryRenderer: () => undefined,
      registerMessageRenderer: () => undefined,
      registerTool: () => undefined,
    } as unknown as ExtensionAPI;
    const state = new AdvisorSessionState();

    try {
      registerAdvisorTool(mockPi, state);
      state.consumeCall();
      expect(
        toolCall(
          { input: {}, toolCallId: "finite", toolName: "ask_advisor" },
          { cwd: agentDir, hasUI: false, isProjectTrusted: () => false }
        )
      ).toMatchObject({ block: true });

      writeFileSync(join(agentDir, "advisor.json"), JSON.stringify({}));
      resetConfigCache();
      expect(
        toolCall(
          { input: {}, toolCallId: "unlimited", toolName: "ask_advisor" },
          { cwd: agentDir, hasUI: false, isProjectTrusted: () => false }
        )
      ).toEqual({});
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("manual consultations use the live unlimited budget", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({ advisorMaxCallsPerSession: 1 })
    );
    resetConfigCache();
    const commands = new Map<string, any>();
    let consultations = 0;
    const mockPi = {
      getActiveTools: () => [],
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      sendMessage: () => undefined,
    } as unknown as ExtensionAPI;
    const state = new AdvisorSessionState();
    state.consumeCall();

    try {
      registerCommands(mockPi, {
        consult: () => {
          consultations += 1;
          return Promise.resolve({ markdown: "ok", thinkingText: "" });
        },
        sessionState: state,
      });
      const ctx = {
        cwd: agentDir,
        hasUI: false,
        isProjectTrusted: () => false,
      } as any;
      await commands.get("advisor-manual").handler("", ctx);
      expect(consultations).toBe(0);

      writeFileSync(join(agentDir, "advisor.json"), JSON.stringify({}));
      resetConfigCache();
      await commands.get("advisor-manual").handler("", ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(consultations).toBe(1);
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("reserves ask_advisor without consuming its budget", () => {
    let toolCall: any;
    const mockPi = {
      events: { emit: () => undefined },
      getActiveTools: () => ["ask_advisor"],
      on(event: string, handler: any) {
        if (event === "tool_call") {
          toolCall = handler;
        }
      },
      registerCommand: () => undefined,
      registerMessageRenderer: () => undefined,
      registerTool: () => undefined,
    } as unknown as ExtensionAPI;
    registerExtension(mockPi);
    advisorSessionState.resetTask();
    toolCall(
      { input: {}, toolCallId: "reserved", toolName: "ask_advisor" },
      { cwd: tmpdir(), hasUI: false, isProjectTrusted: () => false }
    );
    expect(advisorSessionState.consumedCalls).toBe(0);
  });

  test("does not let project Simple mode clear a stale block", async () => {
    let toolCall: any;
    const mockPi = {
      getActiveTools: () => ["ask_advisor"],
      on(event: string, handler: any) {
        if (event === "tool_call") {
          toolCall = handler;
        }
      },
      registerCommand: () => undefined,
      registerMessageRenderer: () => undefined,
      registerTool: () => undefined,
    } as unknown as ExtensionAPI;
    registerAdvisorTool(mockPi);

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

describe("Command configuration errors", () => {
  test("notifies and exits every config-loading command", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(join(agentDir, "advisor.json"), "{ not valid json");
    resetConfigCache();
    const commands = new Map<string, any>();
    const mockPi = {
      getActiveTools: () => [],
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
    } as unknown as ExtensionAPI;
    const notifications: Array<{ message: string; level: string }> = [];
    const context = {
      cwd: tmpdir(),
      hasUI: true,
      isProjectTrusted: () => false,
      ui: {
        notify: (message: string, level: string) =>
          notifications.push({ level, message }),
      },
    } as any;

    try {
      registerCommands(mockPi);
      await Promise.all(
        ["advisor", "advisor-manual", "advisor-models", "advisor-settings"].map(
          (name) =>
            expect(
              commands.get(name).handler("", context)
            ).resolves.toBeUndefined()
        )
      );
      expect(notifications).toHaveLength(4);
      for (const notification of notifications) {
        expect(notification.level).toBe("error");
        expect(notification.message).toContain("advisor.json");
        expect(notification.message).toContain("Fix");
      }
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });
});

describe("Scout Advisor-context integration", () => {
  const entries = [
    {
      id: "u1",
      message: { content: "current task", role: "user" },
      parentId: null,
      timestamp: "2026-01-01T00:00:00Z",
      type: "message",
    },
  ];
  const ctx = {
    sessionManager: { buildContextEntries: () => entries },
  } as any;

  test("disabled mode preserves the exact legacy conversation and makes no Scout call", async () => {
    let calls = 0;
    const legacy = "legacy bytes <&> stay exact";
    const result = await curateAdvisorConversation(
      ctx,
      legacy,
      undefined,
      undefined,
      false,
      (() => {
        calls += 1;
        return Promise.reject(new Error("must not run"));
      }) as any
    );
    expect(result).toEqual({ conversation: legacy });
    expect(calls).toBe(0);
  });

  test("ordinary Scout failure uses the immutable exact legacy conversation", async () => {
    const legacy = "legacy bytes <&> stay exact";
    const result = await curateAdvisorConversation(
      ctx,
      legacy,
      undefined,
      undefined,
      true,
      (async () => ({
        category: "provider-error",
        message: "down",
        metrics: {
          availableCount: 1,
          inputBytes: 10,
          latencyMs: 1,
          omittedBeforeScout: 0,
          selectedCount: 0,
        },
        model: "provider/executor",
        ok: false,
      })) as any
    );
    expect(result.conversation).toBe(legacy);
    expect(result.scout).toMatchObject({
      category: "provider-error",
      ok: false,
    });
  });

  test("zero remaining budget skips Scout and withholds legacy context", async () => {
    let calls = 0;
    const result = await curateAdvisorConversation(
      ctx,
      "legacy history must be withheld",
      undefined,
      undefined,
      true,
      (() => {
        calls += 1;
        throw new Error("Scout must not run without history budget");
      }) as any,
      undefined,
      0
    );
    expect(calls).toBe(0);
    expect(result.conversation).toBe("");
  });

  test("small remaining budget bounds the full curated conversation", async () => {
    let selectedIds: string[] = [];
    const result = await curateAdvisorConversation(
      ctx,
      "legacy",
      undefined,
      undefined,
      true,
      ((_ctx: unknown, manifest: any) => {
        selectedIds = manifest.groups.map((group: any) => group.id);
        return {
          conversation: "unbounded mock output",
          metrics: {
            availableCount: manifest.availableCount,
            inputBytes: manifest.availableBytes,
            latencyMs: 1,
            omittedBeforeScout: manifest.omittedCount,
            selectedCount: selectedIds.length,
          },
          model: "provider/executor",
          ok: true,
          selectedLabels: manifest.groups.map((group: any) => group.label),
          selection: {
            selectedIds,
            synthesis: "x".repeat(1000),
          },
        };
      }) as any,
      undefined,
      200
    );
    expect(result.conversation.length).toBeLessThanOrEqual(200);
    expect(result.conversation).toContain("User: current task");
  });

  test("successful Scout context consists of selected verbatim evidence plus labelled synthesis", async () => {
    const result = await curateAdvisorConversation(
      ctx,
      "legacy",
      undefined,
      undefined,
      true,
      (async (_ctx: unknown, manifest: any) => ({
        conversation: `${manifest.groups[0].content}\n\n[Scout synthesis — untrusted, non-authoritative inference; not evidence]\nOpen decision`,
        metrics: {
          availableCount: 1,
          inputBytes: 10,
          latencyMs: 1,
          omittedBeforeScout: 0,
          selectedCount: 1,
        },
        model: "provider/executor",
        ok: true,
        selectedLabels: [manifest.groups[0].label],
        selection: {
          selectedIds: [manifest.groups[0].id],
          synthesis: "Open decision",
        },
      })) as any
    );
    expect(result.conversation).toContain("User: current task");
    expect(result.conversation).toContain(
      "untrusted, non-authoritative inference"
    );
    expect(result.conversation).not.toContain("legacy");
  });

  test("upstream cancellation stops the operation instead of falling back", async () => {
    const parent = new AbortController();
    parent.abort(new Error("cancelled by user"));
    await expect(
      curateAdvisorConversation(
        ctx,
        "legacy",
        parent.signal,
        undefined,
        true,
        (async () => ({ cancelled: true, ok: false })) as any
      )
    ).rejects.toThrow("cancelled by user");
  });
});

describe("Advisor argument persistence", () => {
  test("does not persist arguments that name an unusable model", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({
        alwaysOn: true,
        contextMaxChars: 15_000,
        executor: "good/executor",
      })
    );
    resetConfigCache();
    const commands = new Map<string, any>();
    const notes: string[] = [];
    const mockPi = {
      getActiveTools: () => ["ask_advisor"],
      on: () => undefined,
      registerCommand(name: string, config: any) {
        commands.set(name, config);
      },
      registerEntryRenderer: () => undefined,
      registerMessageRenderer: () => undefined,
      setActiveTools: () => undefined,
      setModel: () => Promise.resolve(true),
      setThinkingLevel: () => undefined,
    } as unknown as ExtensionAPI;

    try {
      registerCommands(mockPi);
      await commands.get("advisor").handler("executor=missing/model", {
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: {
          find: (provider: string) =>
            provider === "missing" ? undefined : { id: "x", provider },
          getApiKeyAndHeaders: () =>
            Promise.resolve({ apiKey: "key", ok: true }),
        },
        ui: { notify: (message: string) => notes.push(message) },
      } as any);

      expect(notes.join("\n")).toContain("Executor model not found");
      await commands.get("advisor-off").handler("", {
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        ui: { notify: () => undefined },
      } as any);
      expect(
        JSON.parse(readFileSync(join(agentDir, "advisor.json"), "utf8"))
          .executor
      ).toBe("good/executor");
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });
});
