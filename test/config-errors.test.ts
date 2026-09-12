import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { runAdvisorGate } from "../extensions/index.ts";
import { registerCommands } from "../src/commands.ts";
import { resetConfigCache } from "../src/config.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { registerAdvisorTool } from "../src/tools.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { mockPi } from "./helpers/mock-pi.ts";

describe("Command configuration errors", () => {
  test("notifies and exits every config-loading command", async () => {
    await withAgentDir({}, async (agentDir) => {
      writeFileSync(join(agentDir, "advisor.json"), "{ not valid json");
      resetConfigCache();
      const commands = new Map<string, any>();
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

      registerCommands(mockPi({ commands }));
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
    });
  });
});

describe("Tool lifecycle configuration errors", () => {
  test("fails open on invalid advisor.json and resumes gating once fixed", async () => {
    await withAgentDir({}, async (agentDir) => {
      const configPath = join(agentDir, "advisor.json");
      const notifications: Array<{ level: string; message: string }> = [];
      let gateRuns = 0;
      const events = new Map<string, any>();
      registerAdvisorTool(
        mockPi(
          { activeTools: ["ask_advisor"], events },
          {
            registerCommand: () => undefined,
            registerEntryRenderer: () => undefined,
            registerMessageRenderer: () => undefined,
            registerTool: () => undefined,
            sendMessage: () => undefined,
          }
        ),
        new AdvisorSessionState(),
        {
          runGate: (() => {
            gateRuns += 1;
            return {
              decision: "proceed",
              markdown: "Decision: proceed\nContinue.",
              model: "provider/advisor",
              ok: true as const,
              thinkingText: "",
              trigger: "repeated-tool-call" as const,
            };
          }) as unknown as typeof runAdvisorGate,
        }
      );
      const toolCall = events.get("tool_call");
      const ctx = {
        cwd: tmpdir(),
        hasUI: true,
        isProjectTrusted: () => false,
        signal: new AbortController().signal,
        ui: {
          notify: (message: string, level: string) =>
            notifications.push({ level, message }),
          setStatus: () => undefined,
        },
      } as any;
      const readEvent = {
        input: { path: "src/foo.ts" },
        toolCallId: "read-1",
        toolName: "read",
      };

      // An invalid value must not block the tool call; the failure is
      // notified once per outage.
      writeFileSync(configPath, JSON.stringify({ simpleMode: "yes" }));
      resetConfigCache();
      expect(await toolCall(readEvent, ctx)).toBeUndefined();
      expect(await toolCall(readEvent, ctx)).toBeUndefined();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].level).toBe("error");
      expect(notifications[0].message).toContain("simpleMode");
      expect(notifications[0].message).toContain("Fix advisor.json");

      expect(
        await toolCall(
          { input: {}, toolCallId: "advisor-1", toolName: "ask_advisor" },
          ctx
        )
      ).toBeUndefined();

      // Malformed JSON is a new outage and notifies again.
      writeFileSync(configPath, "{ not valid json");
      resetConfigCache();
      expect(await toolCall(readEvent, ctx)).toBeUndefined();
      expect(notifications).toHaveLength(2);

      // A valid configuration resumes automatic gating and stays quiet.
      writeFileSync(configPath, JSON.stringify({ advisorLoopThreshold: 2 }));
      resetConfigCache();
      expect(await toolCall(readEvent, ctx)).toBeUndefined();
      expect(await toolCall(readEvent, ctx)).toBeUndefined();
      expect(gateRuns).toBe(1);
      expect(notifications).toHaveLength(2);
    });
  });
});
