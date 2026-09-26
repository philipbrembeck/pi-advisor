import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCommands } from "../src/commands.ts";
import { resetConfigCache } from "../src/config.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { advisorSessionState, registerAdvisorTool } from "../src/tools.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { mockPi } from "./helpers/mock-pi.ts";

const deferred = () => {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise?.() };
};

describe("Advisor loop-gate budget behavior", () => {
  test("renders automatic-gate Scout fallback before the unaffected Advisor gate", async () => {
    await withAgentDir(
      { advisorLoopThreshold: 2, advisorScoutEnabled: true },
      async (agentDir) => {
        const timeline: string[] = [];
        const sentMessages: any[] = [];
        const invocationIds: unknown[] = [];
        const session = new AdvisorSessionState();
        const events = new Map<string, any>();
        registerAdvisorTool(
          mockPi(
            { activeTools: ["ask_advisor"], events },
            {
              appendEntry(type: string) {
                timeline.push(`entry:${type}`);
              },
              registerEntryRenderer: () => {},
              registerMessageRenderer: () => {},
              registerTool: () => {},
              sendMessage(message: any) {
                sentMessages.push(message);
                timeline.push(`message:${message.customType}`);
              },
            }
          ),
          session,
          {
            runGate: async (
              _ctx: any,
              _question?: string,
              _trigger?: string,
              _signal?: AbortSignal | undefined,
              _onChunk?: any,
              onScout?: any,
              currentInvocationId?: string
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
                decision: "proceed" as const,
                markdown: "Decision: proceed",
                model: "provider/advisor",
                ok: true as const,
                thinkingText: "",
                trigger: "repeated-tool-call" as const,
                usage: {
                  cacheRead: 4,
                  cost: { total: 0.02 },
                  input: 100,
                  output: 20,
                },
              };
            },
          }
        );
        const toolCall = events.get("tool_call");
        const ctx = asExtensionContext({
          cwd: agentDir,
          hasUI: false,
          isProjectTrusted: () => false,
          signal: new AbortController().signal,
        });
        await toolCall(
          { input: { command: "pwd" }, toolCallId: "one", toolName: "bash" },
          ctx
        );
        await toolCall(
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
      }
    );
  });

  test("applies the configured policy to a blocked automatic gate decision", async () => {
    await withAgentDir({}, async (agentDir) => {
      const configPath = join(agentDir, "advisor.json");
      const results: Record<
        string,
        { aborted: boolean; blocked: boolean; result: unknown }
      > = {};

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
        let aborted = false;
        const events = new Map<string, any>();
        registerAdvisorTool(
          mockPi(
            { activeTools: ["ask_advisor"], events },
            {
              registerEntryRenderer: () => {},
              registerMessageRenderer: () => {},
              registerTool: () => {},
              sendMessage: () => {},
            }
          ),
          state,
          {
            runGate: async () => ({
              decision: "blocked",
              markdown: "Decision: blocked\nStop here.",
              model: "provider/advisor",
              ok: true as const,
              thinkingText: "",
              trigger: "repeated-tool-call" as const,
            }),
          }
        );
        const toolCall = events.get("tool_call");
        const ctx = asExtensionContext({
          abort: () => {
            aborted = true;
          },
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          signal: new AbortController().signal,
          ui: {
            notify: () => {},
            setStatus: () => {},
          },
        });
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
    });
  });

  test("uses the live unlimited budget after a finite config reload", async () => {
    await withAgentDir({ advisorMaxCallsPerSession: 1 }, async (agentDir) => {
      const events = new Map<string, any>();
      const state = new AdvisorSessionState();
      registerAdvisorTool(
        mockPi(
          { activeTools: ["ask_advisor"], events },
          {
            registerEntryRenderer: () => {},
            registerMessageRenderer: () => {},
            registerTool: () => {},
          }
        ),
        state
      );
      const toolCall = events.get("tool_call");

      state.consumeCall();
      expect(
        await toolCall(
          { input: {}, toolCallId: "finite", toolName: "ask_advisor" },
          { cwd: agentDir, hasUI: false, isProjectTrusted: () => false }
        )
      ).toMatchObject({ block: true });

      writeFileSync(join(agentDir, "advisor.json"), JSON.stringify({}));
      resetConfigCache();
      expect(
        await toolCall(
          { input: {}, toolCallId: "unlimited", toolName: "ask_advisor" },
          { cwd: agentDir, hasUI: false, isProjectTrusted: () => false }
        )
      ).toEqual({});
    });
  });

  test("manual consultations use the live unlimited budget", async () => {
    await withAgentDir({ advisorMaxCallsPerSession: 1 }, async (agentDir) => {
      const commands = new Map<string, any>();
      let consultations = 0;
      const state = new AdvisorSessionState();
      state.consumeCall();

      registerCommands(mockPi({ commands }, { sendMessage: () => {} }), {
        consult: () => {
          consultations += 1;
          return Promise.resolve({ markdown: "ok", thinkingText: "" });
        },
        sessionState: state,
      });
      const ctx = asExtensionContext({
        cwd: agentDir,
        hasUI: false,
        isProjectTrusted: () => false,
      });
      await commands.get("advisor-manual").handler("", ctx);
      expect(consultations).toBe(0);

      writeFileSync(join(agentDir, "advisor.json"), JSON.stringify({}));
      resetConfigCache();
      await commands.get("advisor-manual").handler("", ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(consultations).toBe(1);
    });
  });

  test("manual consultations register their question and announce informational intent", async () => {
    await withAgentDir({}, async () => {
      const commands = new Map<string, any>();
      const sent: any[] = [];
      const state = new AdvisorSessionState();
      registerCommands(
        mockPi(
          { commands, sent },
          {
            sendMessage: (message: any) => sent.push(message),
          }
        ),
        {
          consult: () =>
            Promise.resolve({
              adviceId: "manual-1",
              markdown: "The answer is 4.",
              thinkingText: "",
            }),
          sessionState: state,
        }
      );
      await commands
        .get("advisor-manual")
        .handler(
          "what is 2+2?",
          asExtensionContext({ cwd: "/", hasUI: false })
        );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(state.reattachedAdviceFor("what is 2+2?")).toBe(
        "The answer is 4."
      );
      // SAFETY: manual result messages carry string content by construction.
      const content = sent.find(
        (message) => message.customType === "advisor-manual-result"
      )?.content as string;
      expect(content).toContain("for your awareness");
      expect(content).toContain("no action or follow-up consultation");
    });
  });

  test("reserves ask_advisor without consuming its budget", () => {
    const events = new Map<string, any>();
    registerAdvisorTool(
      mockPi(
        { activeTools: ["ask_advisor"], events },
        {
          events: { emit: () => {} },
          registerCommand: () => {},
          registerMessageRenderer: () => {},
          registerTool: () => {},
        }
      )
    );
    const toolCall = events.get("tool_call");
    advisorSessionState.resetTask();
    toolCall(
      { input: {}, toolCallId: "reserved", toolName: "ask_advisor" },
      { cwd: tmpdir(), hasUI: false, isProjectTrusted: () => false }
    );
    expect(advisorSessionState.consumedCalls).toBe(0);
  });

  test("releases budget reservations when Jev skips a consultation", async () => {
    await withAgentDir({ advisorMaxCallsPerSession: 1 }, async (agentDir) => {
      const tools = new Map<string, any>();
      const session = new AdvisorSessionState();
      let screens = 0;
      let consultations = 0;
      registerAdvisorTool(
        mockPi(
          { tools },
          { registerTool: (tool: any) => tools.set(tool.name, tool) }
        ),
        session,
        {
          consult: async () => {
            consultations += 1;
            return {
              adviceId: "advice",
              markdown: "Done.",
              model: "provider/advisor",
              thinkingText: "",
              trigger: "executor-requested" as const,
            };
          },
          screen: async () => {
            screens += 1;
            return screens === 1
              ? {
                  decision: "skip" as const,
                  kind: "screened" as const,
                  reason: "low stakes",
                }
              : { decision: "allow" as const };
          },
        }
      );
      const { execute } = tools.get("ask_advisor");
      const ctx = asExtensionContext({
        cwd: agentDir,
        hasUI: false,
        isProjectTrusted: () => false,
      });
      const { signal } = new AbortController();

      const skipped = await execute("first", {}, signal, undefined, ctx);
      const allowed = await execute("second", {}, signal, undefined, ctx);

      expect(skipped.details.jev.skipped).toBe(true);
      expect(allowed.details.adviceId).toBe("advice");
      expect(screens).toBe(2);
      expect(consultations).toBe(1);
      expect(session.consumedCalls).toBe(1);
    });
  });

  test("releases budget reservations when Jev screening fails", async () => {
    await withAgentDir({ advisorMaxCallsPerSession: 1 }, async (agentDir) => {
      const tools = new Map<string, any>();
      const session = new AdvisorSessionState();
      registerAdvisorTool(
        mockPi(
          { tools },
          { registerTool: (tool: any) => tools.set(tool.name, tool) }
        ),
        session,
        { screen: () => Promise.reject(new Error("screen cancelled")) }
      );
      const { execute } = tools.get("ask_advisor");
      const ctx = asExtensionContext({
        cwd: agentDir,
        hasUI: false,
        isProjectTrusted: () => false,
      });

      await expect(
        execute("call", {}, new AbortController().signal, undefined, ctx)
      ).rejects.toThrow("screen cancelled");
      expect(session.consumedCalls).toBe(0);
      expect(session.canConsult(1)).toBe(true);
    });
  });

  test("releases a preflight reservation when execution loses model access", async () => {
    await withAgentDir(
      {
        advisorMaxCallsPerSession: 1,
        advisorModelWhitelist: ["provider/allowed"],
      },
      async (agentDir) => {
        const events = new Map<string, any>();
        const tools = new Map<string, any>();
        const session = new AdvisorSessionState();
        registerAdvisorTool(
          mockPi(
            { activeTools: ["ask_advisor"], events, tools },
            { registerTool: (tool: any) => tools.set(tool.name, tool) }
          ),
          session
        );
        const ctx = asExtensionContext({
          cwd: agentDir,
          hasUI: false,
          isProjectTrusted: () => false,
          model: { id: "allowed", provider: "provider" },
        });
        const toolCall = events.get("tool_call");
        const firstPermission = await toolCall(
          { input: {}, toolCallId: "first", toolName: "ask_advisor" },
          ctx
        );
        const deniedCtx = asExtensionContext({
          cwd: agentDir,
          hasUI: false,
          isProjectTrusted: () => false,
          model: { id: "other", provider: "provider" },
        });

        await expect(
          tools
            .get("ask_advisor")
            .execute(
              "first",
              {},
              new AbortController().signal,
              undefined,
              deniedCtx
            )
        ).rejects.toThrow("provider/other");
        const secondPermission = await toolCall(
          { input: {}, toolCallId: "second", toolName: "ask_advisor" },
          ctx
        );

        expect(firstPermission).toEqual({});
        expect(secondPermission).toEqual({});
      }
    );
  });

  test("counts pending consultations against the session budget", async () => {
    await withAgentDir({ advisorMaxCallsPerSession: 1 }, async (agentDir) => {
      const events = new Map<string, any>();
      const tools = new Map<string, any>();
      const session = new AdvisorSessionState();
      let screens = 0;
      let consultations = 0;
      const screeningBarrier = deferred();
      const screeningStarted = deferred();
      registerAdvisorTool(
        mockPi(
          { activeTools: ["ask_advisor"], events, tools },
          { registerTool: (tool: any) => tools.set(tool.name, tool) }
        ),
        session,
        {
          consult: async () => {
            consultations += 1;
            return {
              adviceId: "advice",
              markdown: "Done.",
              model: "provider/advisor",
              thinkingText: "",
              trigger: "executor-requested" as const,
            };
          },
          screen: async () => {
            screens += 1;
            screeningStarted.resolve();
            await screeningBarrier.promise;
            return { decision: "allow" };
          },
        }
      );
      const ctx = asExtensionContext({
        cwd: agentDir,
        hasUI: false,
        isProjectTrusted: () => false,
      });
      const toolCall = events.get("tool_call");
      const firstPermission = await toolCall(
        { input: {}, toolCallId: "first", toolName: "ask_advisor" },
        ctx
      );
      const firstExecution = tools
        .get("ask_advisor")
        .execute("first", {}, new AbortController().signal, undefined, ctx);
      await screeningStarted.promise;
      const secondPermission = await toolCall(
        { input: {}, toolCallId: "second", toolName: "ask_advisor" },
        ctx
      );
      let secondExecution: Promise<unknown> | undefined;
      if (!secondPermission?.block) {
        secondExecution = tools
          .get("ask_advisor")
          .execute("second", {}, new AbortController().signal, undefined, ctx);
      }
      screeningBarrier.resolve();
      await firstExecution;
      if (secondExecution) {
        await secondExecution;
      }

      expect(firstPermission).toEqual({});
      expect(secondPermission).toMatchObject({ block: true });
      expect(screens).toBe(1);
      expect(consultations).toBe(1);
      expect(session.consumedCalls).toBe(1);
    });
  });
});
