import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import registerExtension, {
  consultAdvisor,
  runAdvisorGate,
} from "../extensions/index.ts";
import { registerCommands } from "../src/commands.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import {
  advisorSessionState,
  parseAutomaticDecision,
  registerAdvisorTool,
} from "../src/tools.ts";
import { mockPi } from "./helpers/mock-pi.ts";

describe("Extension Registration", () => {
  test("exports the stable consultation and gate contract", () => {
    expect(typeof consultAdvisor).toBe("function");
    expect(typeof runAdvisorGate).toBe("function");
    expect(typeof parseAutomaticDecision).toBe("function");
  });
  test("registers the ask_advisor tool and the five advisor commands", () => {
    const tools = new Map<string, any>();
    const commands = new Map<string, any>();

    registerExtension(mockPi({ commands, tools }));

    // Verify tool registered
    expect([...tools.keys()]).toContain("ask_advisor");

    // Verify all commands registered
    expect([...commands.keys()]).toContain("advisor");
    expect([...commands.keys()]).toContain("advisor-manual");
    expect([...commands.keys()]).toContain("advisor-models");
    expect([...commands.keys()]).toContain("advisor-settings");
    expect([...commands.keys()]).toContain("advisor-off");
  });

  test("coalesces Advisor tool updates and flushes on completion", async () => {
    const tools = new Map<string, any>();
    const updates: any[] = [];
    registerAdvisorTool(mockPi({ tools }), new AdvisorSessionState(), {
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
    const advisorTool = tools.get("ask_advisor");

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
    const tools = new Map<string, any>();
    const updates: any[] = [];
    registerAdvisorTool(mockPi({ tools }), new AdvisorSessionState(), {
      consult: (_ctx, _question, _signal, onChunk) => {
        onChunk?.("thinking", "one");
        onChunk?.("thinking", "two");
        return Promise.reject(new Error("provider failed"));
      },
    });
    const advisorTool = tools.get("ask_advisor");

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

    registerCommands(mockPi({ commands, sent }), {
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
    registerCommands(mockPi({ commands }), {
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
    registerCommands(mockPi({ commands, entries }), {
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
    registerCommands(
      mockPi(
        { commands },
        {
          appendEntry(type: string, data: unknown) {
            entries.push({ data, type });
            timeline.push(type);
          },
          sendMessage(message: any) {
            timeline.push(message.customType);
          },
        }
      ),
      {
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
      }
    );
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
    const sent: Array<{ message: any; options: any }> = [];
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

    advisorSessionState.resetTask();
    registerCommands(mockPi({ commands, events, sent }), {
      consult: async () => pendingConsult,
    });
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
    registerCommands(
      mockPi(
        { commands, events },
        {
          appendEntry(type: string) {
            entries.push(type);
          },
        }
      ),
      {
        consult: (_ctx, _question, _signal, _onChunk, onScout) => {
          lateScout = onScout;
          return new Promise(() => undefined);
        },
      }
    );
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
    registerCommands(mockPi({ commands, events }), {
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
    registerCommands(mockPi({ commands }), {
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
});
