import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BeforeAgentStartEvent } from "@earendil-works/pi-coding-agent";

import { resetConfigCache } from "../src/config.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { registerAdvisorTool } from "../src/tools.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { mockPi } from "./helpers/mock-pi.ts";

type PromptSections = BeforeAgentStartEvent["systemPromptOptions"]["sections"];

const harness = (cwd: string, activeTools = ["ask_advisor"]) => {
  const events = new Map<string, any>();
  const session = new AdvisorSessionState();

  const ctx = asExtensionContext({
    cwd,
    hasUI: false,
    isProjectTrusted: () => false,
  });

  registerAdvisorTool(mockPi({ activeTools, events }), session);

  const start = () => {
    const sections: PromptSections = {
      mcp_servers: "Unchanged servers",
    };

    const result = events.get("before_agent_start")(
      { systemPromptOptions: { sections } },
      ctx
    );

    return { result, sections };
  };

  const end = (messages: any[]) =>
    events.get("turn_end")(
      { context: { contextMessages: messages }, toolResults: [] },
      ctx
    );

  return { activeTools, ctx, end, events, session, start };
};

const inContext = (message: any) => ({
  ...message,
  role: "custom",
  timestamp: 0,
});

describe("Executor Advisor budget feedback", () => {
  test("keeps invocation sections stable as the allowance reaches zero", async () => {
    await withAgentDir({ advisorMaxCallsPerSession: 2 }, (dir) => {
      const h = harness(dir);
      const first = h.start();
      h.session.consumeCall();
      const second = h.start();
      h.session.consumeCall();
      const exhausted = h.start();

      expect(second.sections).toEqual(first.sections);
      expect(exhausted.sections).toEqual(first.sections);
      expect(first.sections.mcp_servers).toBe("Unchanged servers");
      expect(JSON.stringify(first.sections)).not.toContain(
        "remaining this session:"
      );
      expect(first.result.message).toMatchObject({
        content: expect.stringContaining(
          "Advisor calls remaining this session: 2."
        ),
        customType: "advisor-budget",
        display: false,
      });
      expect(second.result.message.content).toContain(
        "remaining this session: 1."
      );
      expect(exhausted.result.message.content).toContain(
        "remaining this session: 0."
      );
    });
  });

  test("appends changed feedback after a turn without requesting continuation", async () => {
    await withAgentDir({ advisorMaxCallsPerSession: 2 }, async (dir) => {
      const h = harness(dir);
      const previous = inContext(h.start().result.message);
      const history = [previous];
      const original = structuredClone(history);
      h.session.consumeCall();
      const update = await h.end(history);

      expect(update.continue).toBeUndefined();
      expect(update.entries).toEqual([
        {
          content: expect.stringContaining("remaining this session: 1."),
          customType: "advisor-budget",
          display: false,
          type: "custom_message",
        },
      ]);
      expect(history).toEqual(original);
      const current = inContext(update.entries[0]);
      expect(await h.end([...history, current])).toBeUndefined();
      expect(previous.content).toContain("remaining this session: 2.");
    });
  });

  test("reinstates feedback when compaction removed the previous report", async () => {
    await withAgentDir({ advisorMaxCallsPerSession: 2 }, async (dir) => {
      const h = harness(dir);
      const report = h.start().result.message;
      const update = await h.end([]);
      expect(update.entries[0].content).toBe(report.content);
      expect(update.continue).toBeUndefined();
    });
  });

  test("reports live reservations, releases, and the existing session reset", async () => {
    await withAgentDir({ advisorMaxCallsPerSession: 2 }, (dir) => {
      const h = harness(dir);
      expect(h.session.reserveCall("pending", 2)).toBe(true);
      expect(h.start().result.message.content).toContain(
        "remaining this session: 1."
      );
      h.session.releaseCall("pending");
      expect(h.start().result.message.content).toContain(
        "remaining this session: 2."
      );
      h.session.consumeCall();
      h.session.reserveCall("aborted", 2);
      h.events.get("agent_settled")({}, h.ctx);
      expect(h.start().result.message.content).toContain(
        "remaining this session: 1."
      );
      h.events.get("session_start")({}, h.ctx);
      expect(h.start().result.message.content).toContain(
        "remaining this session: 2."
      );
    });
  });

  test("supersedes finite history after unlimited and Simple mode changes", async () => {
    await withAgentDir({ advisorMaxCallsPerSession: 1 }, (dir) => {
      const h = harness(dir);
      const finite = h.start().result.message;
      h.session.consumeCall();
      writeFileSync(join(dir, "advisor.json"), JSON.stringify({}));
      resetConfigCache();
      expect(h.start().result.message.content).toContain(
        "remaining this session: unlimited."
      );
      writeFileSync(
        join(dir, "advisor.json"),
        JSON.stringify({ advisorMaxCallsPerSession: 1, simpleMode: true })
      );
      resetConfigCache();
      const simple = h.start();
      expect(simple.result.message.content).toContain("Simple mode");
      expect(simple.result.message.content).toContain("unlimited");
      expect(simple.sections.advisor_invocation_settings).toContain(
        "When uncertain"
      );
      expect(finite.content).toContain("remaining this session: 1.");
      expect(h.session.consumedCalls).toBe(1);
    });
  });

  test("does not send allowance messages when Advisor tools are inactive", async () => {
    await withAgentDir({ advisorMaxCallsPerSession: 2 }, async (dir) => {
      const h = harness(dir, []);
      expect(h.start()).toEqual({
        result: undefined,
        sections: { mcp_servers: "Unchanged servers" },
      });
      expect(await h.end([])).toBeUndefined();
    });
  });
});
