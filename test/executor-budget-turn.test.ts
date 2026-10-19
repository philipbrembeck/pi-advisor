import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { AdvisorSessionState } from "../src/session-state.ts";
import { registerAdvisorTool } from "../src/tools.ts";
import type { ToolRegistrationDependencies } from "../src/tools/types.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { mockPi } from "./helpers/mock-pi.ts";

const harness = (cwd: string, dependencies: ToolRegistrationDependencies) => {
  const events = new Map<string, any>();
  const tools = new Map<string, any>();
  const sent: any[] = [];
  const session = new AdvisorSessionState();

  const ctx = asExtensionContext({
    cwd,
    hasUI: false,
    isProjectTrusted: () => false,
    signal: new AbortController().signal,
  });

  registerAdvisorTool(
    mockPi({ activeTools: ["ask_advisor"], events, sent, tools }),
    session,
    dependencies
  );

  const initial = events.get("before_agent_start")(
    { systemPromptOptions: { sections: {} } },
    ctx
  );

  const history = [{ ...initial.message, role: "custom", timestamp: 0 }];

  return {
    async call(id: string) {
      const input = { force: true };

      await events.get("tool_call")(
        { input, toolCallId: id, toolName: "ask_advisor" },
        ctx
      );

      return tools
        .get("ask_advisor")
        .execute(id, input, ctx.signal, undefined, ctx);
    },
    ctx,
    end() {
      return events.get("turn_end")(
        { context: { contextMessages: history }, toolResults: [] },
        ctx
      );
    },
    events,
    history,
    sent,
    session,
  };
};

const consultation = async () => ({
  adviceId: "test-advice",
  markdown: "Review complete.",
  model: "test/advisor",
  thinkingText: "",
  trigger: "executor-requested" as const,
});

describe("Budget feedback after registered consultation paths", () => {
  test("reports a consumed direct call without changing its structured result", async () => {
    await withAgentDir(
      { advisorHerdrIntegration: false, advisorMaxCallsPerSession: 1 },
      async (dir) => {
        const h = harness(dir, { consult: consultation });
        const result = await h.call("direct");
        h.events.get("tool_result")({ toolName: "ask_advisor" });
        const update = await h.end();
        expect(result.structuredContent.text).toBe("Review complete.");
        expect(result.details.text).toBe(result.structuredContent.text);
        expect(result.content[0].text).toBe(
          `Advisor (test/advisor)\n\n${result.structuredContent.text}`
        );
        expect(update.entries[0].content).toContain(
          "remaining this session: 0."
        );
        expect(update.continue).toBeUndefined();
        expect(h.session.consumedCalls).toBe(1);
      }
    );
  });

  test("reports consumption after a provider failure and releases skipped reservations", async () => {
    await withAgentDir(
      { advisorHerdrIntegration: false, advisorMaxCallsPerSession: 1 },
      async (dir) => {
        const failed = harness(dir, {
          consult: () => Promise.reject(new Error("Provider unavailable")),
        });

        await expect(failed.call("failed")).rejects.toThrow(
          "Provider unavailable"
        );
        const failedUpdate = await failed.end();

        expect(failedUpdate.entries[0].content).toContain(
          "remaining this session: 0."
        );

        const skipped = harness(dir, {
          consult: consultation,
          screen: async () => ({
            decision: "skip",
            kind: "screened",
            reason: "low stakes",
          }),
        });

        const result = await skipped.call("skipped");
        expect(result.structuredContent.jev.skipped).toBe(true);
        expect(skipped.session.consumedCalls).toBe(0);
        expect(skipped.session.remainingCalls(1)).toBe(1);
        expect(await skipped.end()).toBeUndefined();
      }
    );
  });

  test("includes the budget consumed by the Jev handler in the same turn", async () => {
    await withAgentDir(
      {
        advisorHerdrIntegration: false,
        advisorJevTurnGateEveryTurns: 1,
        advisorMaxCallsPerSession: 2,
      },
      async (dir) => {
        const h = harness(dir, {
          consult: consultation,
          turnGateDeps: {
            classifyResult: async () => ({
              answers: { should_consult: { noul: 0.9, type: "noul" } },
              model: "test/jev",
            }),
          },
        });

        const update = await h.end();
        expect(h.sent.map(({ message }) => message.customType)).toEqual([
          "advisor-turn-gate-call",
          "advisor-turn-gate-result",
        ]);
        expect(h.session.consumedCalls).toBe(1);
        expect(update.entries[0].content).toContain(
          "remaining this session: 1."
        );
        expect(update.continue).toBeUndefined();
      }
    );
  });

  test("suppresses feedback when model access is lost or tools are disabled", async () => {
    await withAgentDir(
      { advisorHerdrIntegration: false, advisorMaxCallsPerSession: 2 },
      async (dir) => {
        const h = harness(dir, { consult: consultation });
        h.ctx.model = asExtensionContext({
          model: { id: "same", provider: "test" },
        }).model;
        writeFileSync(
          join(dir, "advisor.json"),
          JSON.stringify({ advisor: "test/same", advisorMaxCallsPerSession: 2 })
        );
        expect(await h.end()).toBeUndefined();
        writeFileSync(
          join(dir, "advisor.json"),
          JSON.stringify({
            advisorMaxCallsPerSession: 2,
            advisorModelWhitelist: ["test/other"],
          })
        );
        expect(await h.end()).toBeUndefined();
        writeFileSync(
          join(dir, "advisor.json"),
          JSON.stringify({
            advisorMaxCallsPerSession: 2,
            advisorToolsEnabled: false,
          })
        );
        expect(await h.end()).toBeUndefined();
      }
    );
  });
});
