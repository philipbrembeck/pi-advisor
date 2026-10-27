import { describe, expect, test } from "bun:test";

import { Value } from "typebox/value";

import { executeCodemode } from "../node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/execute.js";
import { setAdvisorToolsEnabledRef } from "../src/config/state.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { registerAdvisorTool } from "../src/tools.ts";
import { assembleConsultationContext } from "../src/tools/consult-context.ts";
import type { ToolRegistrationDependencies } from "../src/tools/types.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { mockPi } from "./helpers/mock-pi.ts";

const scriptText = (result: any) =>
  result.content.map((item: any) => item.text).join("\n");

const harness = (
  cwd: string,
  dependencies: ToolRegistrationDependencies = {},
  modelId = "executor"
) => {
  const tools = new Map<string, any>();
  const events = new Map<string, any>();
  const session = new AdvisorSessionState();
  // The enabled flag is module-global state; concurrent test files (for
  // example config-storage's opt-out test) can leave it disabled while this
  // file is still running, which blocks ask_advisor with "Advisor tools are
  // disabled" instead of producing JSON output. Pin it explicitly.
  setAdvisorToolsEnabledRef(true);
  registerAdvisorTool(
    mockPi({ activeTools: ["ask_advisor"], events, tools }),
    session,
    {
      consult: async () => ({
        adviceId: "advice-1",
        markdown: "Verdict: sound\n\nNo material concerns.",
        model: "provider/advisor",
        thinkingText: "Private thinking",
        trigger: "executor-requested",
        usage: { cost: { total: 0.01 }, input: 12, output: 3 },
      }),
      screen: async () => ({ decision: "allow" }),
      ...dependencies,
    }
  );

  const ctx = asExtensionContext({
    cwd,
    hasUI: false,
    isProjectTrusted: () => false,
    model: { id: modelId, provider: "provider" },
    sessionManager: { buildContextEntries: () => [], getBranch: () => [] },
  });

  const tool = tools.get("ask_advisor");
  let ordinal = 0;
  const results: any[] = [];

  const runOnce = (code: string) =>
    // SAFETY: this fixture supplies every context member the real Codemode executor consumes.
    executeCodemode("code", { code }, undefined, undefined, {
      ...ctx,
      async executeTool(name: string, args: any) {
        ordinal += 1;
        const toolCallId = `code/${ordinal}`;
        let result;
        let isError = false;

        try {
          const block = await events.get("tool_call")(
            {
              input: args,
              parentToolCallId: "code",
              toolCallId,
              toolName: name,
            },
            ctx
          );

          if (block?.block) {
            throw new Error(block.reason);
          }

          if (!Value.Check(tool.parameters, args)) {
            throw new Error("Invalid tool arguments");
          }

          result = await tool.execute(
            toolCallId,
            args,
            undefined,
            undefined,
            ctx
          );
          expect(Value.Check(tool.outputSchema, result.structuredContent)).toBe(
            true
          );
        } catch (error) {
          isError = true;
          result = {
            content: [{ text: String(error), type: "text" }],
            details: undefined,
          };
        }

        results.push(result);
        await events.get("tool_result")({ toolName: name });

        return {
          isError,
          result,
          toolCall: { arguments: args, id: toolCallId, name },
        };
      },
      tools: [tool],
    } as any);

  // Pi 1.3.0 caps live codemode workers process-wide and counts workers until
  // they actually exit; on Bun a finished worker can still be shutting down when
  // the next back-to-back script starts. No tool calls run before the limit
  // error, so retrying does not duplicate fixture state.
  const run = async (code: string) => {
    for (let attempt = 0; ; attempt += 1) {
      const script = await runOnce(code);

      const limitHit =
        Boolean(script.isError) &&
        scriptText(script).includes("Codemode worker limit reached");

      if (!limitHit || attempt >= 40) {
        return script;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  return { ctx, results, run, session, tool };
};

const scriptValue = (result: Awaited<ReturnType<typeof executeCodemode>>) => {
  const last = result.content.at(-1);

  if (last?.type !== "text") {
    throw new Error("Expected script text output");
  }

  return JSON.parse(last.text);
};

const config = {
  advisor: "provider/advisor",
  advisorGitContext: "off" as const,
};

describe("native Pi Codemode Advisor composition", () => {
  test("receives existing response fields without changing interactive content or accounting", async () => {
    await withAgentDir(config, async (cwd) => {
      const h = harness(cwd);
      const script = await h.run("return await tools.ask_advisor({})");
      expect(script.isError).toBeUndefined();
      const value = scriptValue(script);
      expect(value).toEqual({
        adviceId: "advice-1",
        advisor: "provider/advisor",
        followUp: false,
        text: "Verdict: sound\n\nNo material concerns.",
        usage: { cost: 0.01, input: 12, output: 3 },
      });
      expect(value.decision).toBeUndefined();
      expect(value.thinking).toBeUndefined();
      expect(h.results[0].content[0].text).toBe(
        `Advisor (provider/advisor)\n\n${value.text}`
      );
      expect(h.results[0].details.thinking).toBe("Private thinking");
      expect(h.results[0].usage.cost.total).toBe(0.01);
      expect(h.session.consumedCalls).toBe(1);
      expect(h.session.blocked).toBe(false);
    });
  });

  test.each(["screened", "repeat"] as const)(
    "%s skips remain normal results without advice IDs or budget spend",
    async (kind) => {
      await withAgentDir(config, async (cwd) => {
        const h = harness(cwd, {
          consult: async () => {
            throw new Error("Must not consult");
          },
          screen: async () => ({
            decision: "skip",
            kind,
            reason: "test skip",
            reattachedAdvice: "Earlier advice",
          }),
        });

        const script = await h.run("return await tools.ask_advisor({})");
        const value = scriptValue(script);
        expect(script.isError).toBeUndefined();
        expect(value.jev).toEqual({ kind, reason: "test skip", skipped: true });
        expect(value.adviceId).toBeUndefined();
        expect(value.text).toBe(h.results[0].content[0].text);

        if (kind === "repeat") {
          expect(value.text).toContain("Earlier advice");
        }

        expect(h.session.consumedCalls).toBe(0);
      });
    }
  );

  test("same-model skip remains composable and free", async () => {
    await withAgentDir(config, async (cwd) => {
      const h = harness(cwd, {}, "advisor");
      const script = await h.run("return await tools.ask_advisor({})");
      const value = scriptValue(script);
      expect(value.skipReason).toContain("Advisor disabled");
      expect(value.adviceId).toBeUndefined();
      expect(value.usage).toBeUndefined();
      expect(h.session.consumedCalls).toBe(0);
    });
  });

  test("forwards existing draft and Git context arguments without a new evidence API", async () => {
    await withAgentDir(config, async (cwd) => {
      const received: unknown[][] = [];

      const h = harness(cwd, {
        consult: async (...args) => {
          received.push(args);

          return {
            adviceId: "draft-advice",
            markdown: "Review notes",
            model: "provider/advisor",
            thinkingText: "",
            trigger: "executor-requested",
          };
        },
      });

      const script = await h.run(
        'const draft = JSON.stringify({ tests: { exit_code: 0 } }); return await tools.ask_advisor({ draft, gitContext: "full" })'
      );

      expect(script.isError).toBeUndefined();
      expect(received[0]?.[5]).toBe("full");
      expect(received[0]?.[6]).toBe('{"tests":{"exit_code":0}}');
      expect(h.results[0].structuredContent.usage).toBeUndefined();
    });
  });

  test("existing draft redaction and caps apply without widening Git disclosure", async () => {
    await withAgentDir(
      { ...config, advisorRedactSecrets: true },
      async (cwd) => {
        const h = harness(cwd, {
          consult: async (
            ctx,
            _question,
            _signal,
            _onChunk,
            _trigger,
            gitContext,
            draft
          ) => {
            const context = await assembleConsultationContext({
              ctx,
              draft,
              gitContext,
            });

            expect(context.draftText).toContain("[REDACTED SECRET]");
            expect(context.draftText).not.toContain("hunter2");
            expect(
              Buffer.byteLength(context.draftText ?? "", "utf-8")
            ).toBeLessThanOrEqual(8192);
            expect(context.changeText).toContain("withheld");

            return {
              adviceId: "bounded-draft",
              markdown: "Unverified draft reviewed",
              model: "provider/advisor",
              thinkingText: "",
              trigger: "executor-requested",
            };
          },
        });

        const script = await h.run(
          'return await tools.ask_advisor({ draft: "password=hunter2\\n" + "x".repeat(10000), gitContext: "full" })'
        );

        expect(script.isError).toBeUndefined();
        expect(scriptValue(script).adviceId).toBe("bounded-draft");
      }
    );
  });

  test("provider errors and session blocks reject rather than become consultation decisions", async () => {
    await withAgentDir(config, async (cwd) => {
      const h = harness(cwd, {
        consult: async () => {
          throw new Error("Provider unavailable");
        },
      });

      const failure = await h.run(
        "try { await tools.ask_advisor({}); } catch (error) { return error.message; }"
      );

      expect(scriptText(failure)).toContain("Provider unavailable");
      expect(h.results[0].structuredContent).toBeUndefined();
      h.session.block("Existing session block");

      const blocked = await h.run(
        "try { await tools.ask_advisor({}); } catch (error) { return error.message; }"
      );

      expect(scriptText(blocked)).toContain("Existing session block");
      expect(h.session.blocked).toBe(true);
      expect(h.session.consumedCalls).toBe(1);
    });
  });
});
