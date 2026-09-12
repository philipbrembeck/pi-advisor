import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerCommands } from "../src/commands.ts";
import { resetConfigCache } from "../src/config.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { advisorSessionState, registerAdvisorTool } from "../src/tools.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { mockPi } from "./helpers/mock-pi.ts";

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
              registerEntryRenderer: () => undefined,
              registerMessageRenderer: () => undefined,
              registerTool: () => undefined,
              sendMessage(message: any) {
                sentMessages.push(message);
                timeline.push(`message:${message.customType}`);
              },
            }
          ),
          session,
          {
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
          }
        );
        const toolCall = events.get("tool_call");
        const ctx = {
          cwd: agentDir,
          hasUI: false,
          isProjectTrusted: () => false,
          signal: new AbortController().signal,
        } as any;
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
              registerEntryRenderer: () => undefined,
              registerMessageRenderer: () => undefined,
              registerTool: () => undefined,
              sendMessage: () => undefined,
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
            registerEntryRenderer: () => undefined,
            registerMessageRenderer: () => undefined,
            registerTool: () => undefined,
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

      registerCommands(mockPi({ commands }, { sendMessage: () => undefined }), {
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
    });
  });

  test("reserves ask_advisor without consuming its budget", () => {
    const events = new Map<string, any>();
    registerAdvisorTool(
      mockPi(
        { activeTools: ["ask_advisor"], events },
        {
          events: { emit: () => undefined },
          registerCommand: () => undefined,
          registerMessageRenderer: () => undefined,
          registerTool: () => undefined,
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
});
