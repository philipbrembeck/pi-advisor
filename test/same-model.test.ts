import { afterEach, describe, expect, test } from "bun:test";

import { registerCommands } from "../src/commands.ts";
import { saveAdvisorSettings } from "../src/commands/settings-persistence.ts";
import {
  advisorDisableSameModelRef,
  getAdvisorSettings,
  setAdvisorDisableSameModelRef,
} from "../src/config/state.ts";
import { loadConfig, saveConfig } from "../src/config/storage.ts";
import { validateConfig } from "../src/config/validation.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { registerAdvisorTool } from "../src/tools.ts";
import { consultAdvisor } from "../src/tools/consultation.ts";
import { handleJevTurnEnd } from "../src/tools/jev-turn-gate.ts";
import type { JevTurnGateRegistration } from "../src/tools/jev-turn-gate.ts";
import {
  advisorModelIsAllowed,
  sameModelAdvisorDisabled,
} from "../src/tools/model-access.ts";
import { savedConfig, withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { activationContext, activationHarness } from "./helpers/harness.ts";
import { mockPi } from "./helpers/mock-pi.ts";

afterEach(() => setAdvisorDisableSameModelRef(true));

const modelContext = (cwd: string, id: string, notices: string[] = []) =>
  asExtensionContext({
    cwd,
    hasUI: true,
    isProjectTrusted: () => false,
    model: { id, provider: "provider" },
    signal: new AbortController().signal,
    ui: {
      notify: (message: string) => notices.push(message),
      setStatus: () => {},
    },
  });

describe("same-model Advisor suppression", () => {
  test("defaults on, validates boolean values and saves without dropping unknown keys", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", unknownFutureField: "retained" },
      (agentDir) => {
        const ctx = modelContext(agentDir, "advisor");
        loadConfig(ctx);
        expect(advisorDisableSameModelRef).toBe(true);
        expect(getAdvisorSettings().disableSameModel).toBe(true);
        expect(() =>
          validateConfig({ advisorDisableSameModel: "off" })
        ).toThrow("advisorDisableSameModel");
        setAdvisorDisableSameModelRef(false);
        saveConfig(ctx);
        expect(savedConfig(agentDir)).toMatchObject({
          advisorDisableSameModel: false,
          unknownFutureField: "retained",
        });
        loadConfig(ctx);
        expect(advisorDisableSameModelRef).toBe(false);
      }
    );
  });

  test("compares the active provider/model, not the saved Executor or thinking level", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", executor: "provider/other" },
      (agentDir) => {
        loadConfig(modelContext(agentDir, "advisor"));
        expect(
          sameModelAdvisorDisabled(modelContext(agentDir, "advisor"))
        ).toBe(true);
        expect(advisorModelIsAllowed(modelContext(agentDir, "advisor"))).toBe(
          false
        );
        expect(sameModelAdvisorDisabled(modelContext(agentDir, "other"))).toBe(
          false
        );
        setAdvisorDisableSameModelRef(false);
        expect(
          sameModelAdvisorDisabled(modelContext(agentDir, "advisor"))
        ).toBe(false);
      }
    );
  });

  test("skips tool, screen, gates and handoff before spending budget; re-enables on switch", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorLoopThreshold: 2,
        advisorMaxCallsPerSession: 1,
        advisorTrackedFileContent: true,
      },
      async (agentDir) => {
        const events = new Map<string, any>();
        const tools = new Map<string, any>();
        const session = new AdvisorSessionState();
        session.issueAdvice(
          "earlier",
          "Review notes/review.md",
          "executor-requested"
        );
        let screenCalls = 0;
        let consultCalls = 0;
        let gateCalls = 0;
        registerAdvisorTool(
          mockPi({ activeTools: ["ask_advisor"], events, tools }),
          session,
          {
            consult: async () => {
              consultCalls += 1;

              return {
                adviceId: "later",
                markdown: "Advice",
                model: "provider/advisor",
                thinkingText: "",
                trigger: "executor-requested",
              };
            },
            runGate: async () => {
              gateCalls += 1;
              throw new Error("The gate must not run");
            },
            screen: async () => {
              screenCalls += 1;

              return { decision: "allow" };
            },
          }
        );
        const same = modelContext(agentDir, "advisor");
        const call = events.get("tool_call");
        const params = { includeTrackedFiles: ["notes/review.md"] };
        expect(
          await call(
            { input: params, toolCallId: "skip", toolName: "ask_advisor" },
            same
          )
        ).toBeUndefined();

        const skipped = await tools
          .get("ask_advisor")
          .execute("skip", params, same.signal, undefined, same);

        expect(skipped.details.skipReason).toContain("Advisor disabled");

        for (const toolCallId of ["a", "b"]) {
          expect(
            await call(
              { input: { path: "same" }, toolCallId, toolName: "read" },
              same
            )
          ).toBeUndefined();
        }

        expect(session.consumedCalls).toBe(0);
        expect(session.blocked).toBe(false);
        expect([screenCalls, consultCalls, gateCalls]).toEqual([0, 0, 0]);

        const other = modelContext(agentDir, "other");
        expect(
          await call(
            { input: params, toolCallId: "go", toolName: "ask_advisor" },
            other
          )
        ).toEqual({});

        const result = await tools
          .get("ask_advisor")
          .execute("go", params, other.signal, undefined, other);

        expect(result.details.text).toBe("Advice");
        expect([screenCalls, consultCalls, gateCalls]).toEqual([1, 1, 0]);
        expect(session.consumedCalls).toBe(1);
        session.block("existing safety block");
        expect(
          await call(
            {
              input: { path: "ordinary" },
              toolCallId: "blocked",
              toolName: "read",
            },
            same
          )
        ).toMatchObject({ block: true, reason: "existing safety block" });
        await expect(
          tools
            .get("ask_advisor")
            .execute("again", params, other.signal, undefined, other)
        ).rejects.toThrow("budget exhausted");
      }
    );
  });

  test("never starts manual or direct consultation with the same active model", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", advisorMaxCallsPerSession: 1 },
      async (agentDir) => {
        const commands = new Map<string, any>();
        const state = new AdvisorSessionState();
        let calls = 0;
        registerCommands(mockPi({ commands }), {
          consult: async () => {
            calls += 1;

            return { markdown: "Advice", thinkingText: "" };
          },
          sessionState: state,
        });
        const notices: string[] = [];
        const same = modelContext(agentDir, "advisor", notices);
        await commands.get("advisor-manual").handler("Review", same);
        expect(notices.join(" ")).toContain("Advisor disabled");
        expect(calls).toBe(0);
        expect(state.consumedCalls).toBe(0);
        await expect(consultAdvisor(same, "Review")).rejects.toThrow(
          "Advisor disabled"
        );
      }
    );
  });

  test("saves the UI opt-out and allows an intentional same-model review", async () => {
    await withAgentDir({ advisor: "provider/advisor" }, (agentDir) => {
      const ctx = modelContext(agentDir, "advisor");
      loadConfig(ctx);
      saveAdvisorSettings(ctx, {
        ...getAdvisorSettings(),
        disableSameModel: false,
      });
      expect(savedConfig(agentDir).advisorDisableSameModel).toBe(false);
      loadConfig(ctx);
      expect(sameModelAdvisorDisabled(ctx)).toBe(false);
    });
  });

  test("skips proactive Jev checks before any Advisor budget is spent", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", advisorJevTurnGateEveryTurns: 1 },
      async (agentDir) => {
        const same = modelContext(agentDir, "advisor");
        loadConfig(same);
        const session = new AdvisorSessionState();

        const registration: JevTurnGateRegistration = {
          activeTools: () => ["ask_advisor"],
          consult: async () => {
            throw new Error("The Advisor must not run");
          },
          send: () => {},
          session,
        };

        await handleJevTurnEnd(registration, same);
        expect(session.consumedCalls).toBe(0);
      }
    );
  });

  test("/advisor-models re-checks the active Executor after saving a new Advisor", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", executor: "provider/advisor" },
      async (agentDir) => {
        const { commands, events, pi } = activationHarness();
        registerCommands(pi);
        const notices: string[] = [];
        let picker = 0;

        const ctx = asExtensionContext({
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          model: { id: "advisor", provider: "provider" },
          modelRegistry: {
            find: (provider: string, id: string) => ({ id, provider }),
            getApiKeyAndHeaders: () =>
              Promise.resolve({ apiKey: "key", ok: true }),
            getAvailable: () => [
              { id: "advisor", provider: "provider" },
              { id: "other", provider: "provider" },
            ],
          },
          ui: {
            custom: (factory: any) =>
              new Promise((resolve) => {
                const list = factory(
                  { requestRender: () => {} },
                  {
                    bold: (text: string) => text,
                    fg: (_color: string, text: string) => text,
                  },
                  { matches: () => false },
                  resolve
                );

                if (picker === 1) {
                  for (const key of "other") {
                    list.handleInput(key);
                  }
                }

                picker += 1;
                list.render(100);
                list.handleInput("\r");
              }),
            notify: (message: string) => notices.push(message),
            select: () => Promise.resolve("✓ Default (Model Default)"),
          },
        });

        await events.get("session_start")?.({ reason: "startup" }, ctx);
        expect(
          notices.filter((note) => note.startsWith("Advisor disabled:"))
        ).toHaveLength(1);
        await commands.get("advisor-models").handler("", ctx);
        expect(savedConfig(agentDir).advisor).toBe("provider/other");
        expect(
          notices.filter((note) => note.startsWith("Advisor re-enabled:"))
        ).toHaveLength(1);
      }
    );
  });

  test("notifies once per transition after activation and set/cycle/restore selections", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", executor: "provider/advisor" },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = activationHarness();
        registerCommands(pi);
        setActiveTools([]);
        const notices: string[] = [];
        const ctx = activationContext(agentDir, notices);
        await commands.get("advisor").handler("", ctx);
        expect(pi.getActiveTools()).toContain("ask_advisor");
        expect(
          notices.filter((note) => note.startsWith("Advisor disabled:"))
        ).toHaveLength(1);
        events.get("model_select")?.(
          { model: { id: "other", provider: "provider" }, source: "cycle" },
          ctx
        );
        expect(
          notices.filter((note) => note.startsWith("Advisor re-enabled:"))
        ).toHaveLength(1);
        events.get("model_select")?.(
          { model: { id: "advisor", provider: "provider" }, source: "restore" },
          ctx
        );
        expect(
          notices.filter((note) => note.startsWith("Advisor disabled:"))
        ).toHaveLength(2);
        events.get("model_select")?.(
          { model: { id: "advisor", provider: "provider" }, source: "set" },
          ctx
        );
        expect(
          notices.filter((note) => note.startsWith("Advisor disabled:"))
        ).toHaveLength(2);
      }
    );
  });
});
