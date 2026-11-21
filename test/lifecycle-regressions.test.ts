import { expect, spyOn, test } from "bun:test";

import { ExtensionRunner } from "@earendil-works/pi-coding-agent";

import { registerCommands } from "../src/commands.ts";
import { loadConfig } from "../src/config.ts";
import { registerAdvisorTool } from "../src/tools.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { activationContext, activationHarness } from "./helpers/harness.ts";
import { mockPi } from "./helpers/mock-pi.ts";

type HandlerError = Parameters<ExtensionRunner["emitError"]>[0];

test("appends budget feedback after an earlier turn_end compaction draft", async () => {
  await withAgentDir({ advisorLogFeedback: true }, async (dir) => {
    const ctx = activationContext(dir);
    loadConfig(ctx);
    const events = new Map();
    registerAdvisorTool(mockPi({ activeTools: ["ask_advisor"], events }));

    const compaction = {
      firstKeptEntryId: null,
      summary: "Earlier context",
      type: "compaction",
    } as const;

    const runner: ExtensionRunner = Object.create(ExtensionRunner.prototype);

    const handlerErrors: HandlerError[] = [];
    Object.assign(runner, {
      createContext: () => ctx,
      emitError: (error: HandlerError) => handlerErrors.push(error),
      extensions: [
        {
          handlers: new Map([
            ["turn_end", [() => ({ continue: true, entries: [compaction] })]],
          ]),
          path: "<compaction>",
        },
        {
          handlers: new Map([["turn_end", [events.get("turn_end")]]]),
          path: "<advisor>",
        },
      ],
    });

    const result = await runner.emitBoundary(
      {
        message: { content: "Synthetic turn", role: "user", timestamp: 0 },
        messageEntryId: "message",
        outcome: "completed",
        toolResultEntryIds: [],
        toolResults: [],
        turnIndex: 0,
        type: "turn_end",
      },
      () => ({
        canContinue: true,
        contextEntries: [],
        contextMessages: [],
        llmMessages: [],
        pendingMessages: [],
      })
    );

    expect(handlerErrors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.continue).toBe(true);
    expect(result.entries).toEqual([
      compaction,
      expect.objectContaining({
        customType: "advisor-budget",
        type: "custom_message",
      }),
    ]);
  });
});

test.each(["startup", "resume", "reload"])(
  "always-on %s does not rewrite an already active Advisor tool set",
  async (reason) => {
    await withAgentDir(
      { advisor: "provider/advisor", alwaysOn: true },
      async (dir) => {
        const { events, pi, setActiveTools } = activationHarness();

        const active = [
          "read",
          "ask_advisor",
          "other_tool",
          "record_advisor_outcome",
        ];

        setActiveTools(active);
        const setTools = spyOn(pi, "setActiveTools");
        const ctx = activationContext(dir);
        const authenticate = spyOn(ctx.modelRegistry, "getApiKeyAndHeaders");
        registerCommands(pi);

        await events.get("session_start")?.({ reason }, ctx);

        expect(authenticate).toHaveBeenCalledTimes(1);
        expect(setTools).not.toHaveBeenCalled();
        expect(pi.getActiveTools()).toEqual(active);
      }
    );
  }
);

test("always-on still removes Advisor tools if authentication fails", async () => {
  await withAgentDir(
    { advisor: "provider/advisor", alwaysOn: true },
    async (dir) => {
      const { events, pi, setActiveTools } = activationHarness();
      setActiveTools(["read", "ask_advisor", "record_advisor_outcome"]);
      const notes: string[] = [];
      const ctx = activationContext(dir, notes);
      spyOn(ctx.modelRegistry, "getApiKeyAndHeaders").mockResolvedValue({
        error: "Test auth failure",
        ok: false,
      });
      registerCommands(pi);

      await events.get("session_start")?.({ reason: "reload" }, ctx);

      expect(pi.getActiveTools()).toEqual(["read"]);
      expect(notes).toEqual([
        expect.stringContaining("No API key for Advisor"),
      ]);
    }
  );
});
