import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { registerCommands } from "../src/commands.ts";
import type { AdvisorModelSelection } from "../src/commands/model-picker.ts";
import { getAdvisorSettings, resetConfigCache } from "../src/config.ts";
import { setContextMaxCharsRef } from "../src/config/state.ts";
import { loadConfig } from "../src/config/storage.ts";
import { savedConfig, withAgentDir } from "./helpers/config-fixture.ts";
import { makeUiContext, registerTool } from "./helpers/configuration-tool.ts";
import { mockPi } from "./helpers/mock-pi.ts";

describe("model-callable Advisor configuration", () => {
  afterEach(() => resetConfigCache());

  test("registers advisor_config with the extension command surface", () => {
    const tools = new Map<string, unknown>();

    registerCommands(mockPi({ tools }));

    expect(tools.has("advisor_config")).toBe(true);
  });

  test("read returns effective settings without unknown fields or private JEV config", async () => {
    await withAgentDir(
      {
        advisorJevBaseUrl: "https://private.example.test/api",
        advisorJevKeyProvider: "private-provider",
        futureSetting: "do not expose",
        simpleMode: true,
      },
      async (agentDir) => {
        const { tool } = registerTool();
        const { ctx } = makeUiContext(agentDir);
        loadConfig(ctx);
        setContextMaxCharsRef(33_000);

        const result = await tool.execute(
          "read-1",
          { action: "read" },
          undefined,
          undefined,
          ctx
        );

        const response = JSON.parse(result.content[0].text);

        expect(response.scope).toBe("global");
        expect(response.effectiveSettings.simpleMode).toBe(true);
        expect(response.globalOverrides.simpleMode).toBe(true);
        expect(response.effectiveSettings.contextMaxChars).toBe(33_000);
        expect(getAdvisorSettings().contextMaxChars).toBe(33_000);
        expect(response.readOnlyKeys).toContain("advisorJevClassifier");
        expect(response.effectiveSettings).not.toHaveProperty(
          "advisorJevBaseUrl"
        );
        expect(response.effectiveSettings).not.toHaveProperty(
          "advisorJevKeyProvider"
        );
        expect(result.content[0].text).not.toContain("futureSetting");
        expect(result.content[0].text).not.toContain("private.example.test");
      }
    );
  });

  test("requires confirmation and persists only the requested patch", async () => {
    await withAgentDir(
      { futureSetting: { keep: true }, simpleMode: false },
      async (agentDir) => {
        const { tool } = registerTool();
        const { confirmations, ctx } = makeUiContext(agentDir);
        loadConfig(ctx);
        setContextMaxCharsRef(33_000);

        const result = await tool.execute(
          "update-1",
          { action: "update", changes: { simpleMode: true } },
          undefined,
          undefined,
          ctx
        );

        expect(confirmations).toHaveLength(1);
        expect(confirmations[0]?.body).toContain("simpleMode: false → true");
        expect(result.details).toMatchObject({
          action: "update",
          applied: true,
        });
        expect(getAdvisorSettings().simpleMode).toBe(true);
        expect(getAdvisorSettings().contextMaxChars).toBe(33_000);
        expect(savedConfig(agentDir)).not.toHaveProperty("contextMaxChars");
        expect(savedConfig(agentDir)).toMatchObject({
          futureSetting: { keep: true },
          simpleMode: true,
        });
      }
    );
  });

  test("cancelled confirmation leaves disk and runtime unchanged", async () => {
    await withAgentDir({ simpleMode: false }, async (agentDir) => {
      const { tool } = registerTool();
      const { ctx } = makeUiContext(agentDir, { confirm: async () => false });
      loadConfig(ctx);
      const original = readFileSync(join(agentDir, "advisor.json"), "utf-8");

      const result = await tool.execute(
        "update-cancel",
        { action: "update", changes: { simpleMode: true } },
        undefined,
        undefined,
        ctx
      );

      expect(result.details).toMatchObject({ applied: false, cancelled: true });
      expect(readFileSync(join(agentDir, "advisor.json"), "utf-8")).toBe(
        original
      );
      expect(getAdvisorSettings().simpleMode).toBe(false);
    });
  });

  test("refuses updates without UI and rejects unsupported or invalid keys before confirmation", async () => {
    await withAgentDir({ simpleMode: false }, async (agentDir) => {
      const { tool } = registerTool();

      const { ctx: noUi } = makeUiContext(agentDir, {
        hasUI: false,
        mode: "print",
      });

      loadConfig(noUi);
      const original = readFileSync(join(agentDir, "advisor.json"), "utf-8");

      await expect(
        tool.execute(
          "no-ui",
          { action: "update", changes: { simpleMode: true } },
          undefined,
          undefined,
          noUi
        )
      ).rejects.toThrow("interactive confirmation");

      const { confirmations, ctx } = makeUiContext(agentDir);
      await expect(
        tool.execute(
          "unsupported",
          {
            action: "update",
            changes: { advisorJevBaseUrl: "https://x.test" },
          },
          undefined,
          undefined,
          ctx
        )
      ).rejects.toThrow("dedicated UI flow");
      await expect(
        tool.execute(
          "invalid",
          { action: "update", changes: { advisorLoopThreshold: 1 } },
          undefined,
          undefined,
          ctx
        )
      ).rejects.toThrow("advisorLoopThreshold");

      expect(confirmations).toHaveLength(0);
      expect(readFileSync(join(agentDir, "advisor.json"), "utf-8")).toBe(
        original
      );
    });
  });

  test("clearing Advisor tools also clears Always on and leaves this tool active", async () => {
    await withAgentDir(
      { advisorToolsEnabled: true, alwaysOn: true },
      async (agentDir) => {
        const { runtime, tool } = registerTool({
          activeTools: [
            "bash",
            "ask_advisor",
            "record_advisor_outcome",
            "advisor_config",
          ],
        });

        const { confirmations, ctx } = makeUiContext(agentDir);
        loadConfig(ctx);

        const result = await tool.execute(
          "disable-tools",
          { action: "update", changes: { advisorToolsEnabled: false } },
          undefined,
          undefined,
          ctx
        );

        expect(confirmations[0]?.body).toContain("alwaysOn: true → false");
        expect(savedConfig(agentDir)).toMatchObject({
          advisorToolsEnabled: false,
          alwaysOn: false,
        });
        expect(runtime.pi.getActiveTools()).toContain("advisor_config");
        expect(runtime.pi.getActiveTools()).not.toContain("ask_advisor");
        expect(result.details).toMatchObject({ applied: true });

        const reenabled = await tool.execute(
          "reenable-tools",
          { action: "update", changes: { advisorToolsEnabled: true } },
          undefined,
          undefined,
          ctx
        );

        expect(reenabled.details).toMatchObject({ applied: true });
        expect(runtime.pi.getActiveTools()).toContain("advisor_config");
        expect(runtime.pi.getActiveTools()).toContain("ask_advisor");
        expect(savedConfig(agentDir).advisorToolsEnabled).toBe(true);
      }
    );
  });

  test("model changes use the picker result and write nothing when picker is cancelled", async () => {
    await withAgentDir(
      { advisor: "openai/current", executor: "openai/executor" },
      async (agentDir) => {
        const models = [
          { id: "current", provider: "openai" },
          { id: "picked", provider: "openai" },
          { id: "executor", provider: "openai" },
        ];

        const selected: AdvisorModelSelection = {
          advisor: "openai/picked",
          advisorEffort: "high",
          advisorFallbackModel: undefined,
          executor: "openai/executor",
          executorEffort: undefined,
        };

        const picks: unknown[] = [];

        const { tool: cancelledTool } = registerTool({
          selectModels: async (_ctx, params) => {
            picks.push(params);

            return undefined;
          },
        });

        const { ctx: cancelContext } = makeUiContext(agentDir, { models });
        loadConfig(cancelContext);
        const before = readFileSync(join(agentDir, "advisor.json"), "utf-8");

        const cancelled = await cancelledTool.execute(
          "model-cancel",
          { action: "update", changes: { advisor: "openai/picked" } },
          undefined,
          undefined,
          cancelContext
        );

        expect(cancelled.details).toMatchObject({ cancelled: true });
        expect(picks).toHaveLength(1);
        expect(readFileSync(join(agentDir, "advisor.json"), "utf-8")).toBe(
          before
        );

        const { tool } = registerTool({
          selectModels: async () => selected,
        });

        const { ctx } = makeUiContext(agentDir, { models });
        loadConfig(ctx);
        await tool.execute(
          "model-set",
          { action: "update", changes: { advisor: "openai/picked" } },
          undefined,
          undefined,
          ctx
        );

        expect(savedConfig(agentDir).advisor).toBe("openai/picked");
        expect(savedConfig(agentDir).advisorEffort).toBe("high");
      }
    );
  });

  test("refuses dependent settings changed during confirmation", async () => {
    await withAgentDir(
      { advisorToolsEnabled: true, alwaysOn: false },
      async (agentDir) => {
        const { tool } = registerTool();

        const { ctx } = makeUiContext(agentDir, {
          confirm: async () => {
            writeFileSync(
              join(agentDir, "advisor.json"),
              JSON.stringify({ advisorToolsEnabled: false, alwaysOn: false })
            );

            return true;
          },
        });

        loadConfig(ctx);

        await expect(
          tool.execute(
            "stale",
            { action: "update", changes: { alwaysOn: true } },
            undefined,
            undefined,
            ctx
          )
        ).rejects.toThrow("changed while confirmation was open");
        expect(savedConfig(agentDir)).toMatchObject({
          advisorToolsEnabled: false,
          alwaysOn: false,
        });
      }
    );
  });

  test("preserves unrelated external edits made while confirmation is open", async () => {
    await withAgentDir(
      { externalSetting: "old", simpleMode: false },
      async (agentDir) => {
        const { tool } = registerTool();

        const { ctx } = makeUiContext(agentDir, {
          confirm: async () => {
            writeFileSync(
              join(agentDir, "advisor.json"),
              JSON.stringify({
                externalSetting: "new",
                simpleMode: false,
              })
            );

            return true;
          },
        });

        loadConfig(ctx);

        const result = await tool.execute(
          "external-edit",
          { action: "update", changes: { simpleMode: true } },
          undefined,
          undefined,
          ctx
        );

        expect(result.details).toMatchObject({ applied: true });
        expect(savedConfig(agentDir)).toMatchObject({
          externalSetting: "new",
          simpleMode: true,
        });
      }
    );
  });

  test("reports saved settings when current-session reload fails", async () => {
    await withAgentDir(
      { futureSetting: true, simpleMode: false },
      async (agentDir) => {
        const { tool } = registerTool();
        let failRefresh = false;

        const { ctx } = makeUiContext(agentDir, {
          confirm: async () => {
            failRefresh = true;

            return true;
          },
          notify: (message) => {
            if (failRefresh && message.includes("unrecognized key")) {
              throw new Error("simulated UI refresh failure");
            }
          },
        });

        loadConfig(ctx);

        const result = await tool.execute(
          "reload-failure",
          { action: "update", changes: { simpleMode: true } },
          undefined,
          undefined,
          ctx
        );

        expect(result.details).toMatchObject({ applied: false, saved: true });
        expect(result.content[0]?.text).toContain("settings were saved");
        expect(savedConfig(agentDir).simpleMode).toBe(true);
      }
    );
  });

  test("uses the dedicated outcome consent persistence path", async () => {
    await withAgentDir({}, async (agentDir) => {
      const { tool } = registerTool();
      const { ctx } = makeUiContext(agentDir);
      loadConfig(ctx);

      const result = await tool.execute(
        "outcome-logging",
        { action: "update", changes: { advisorOutcomeLogging: true } },
        undefined,
        undefined,
        ctx
      );

      expect(result.details).toMatchObject({ applied: true });
      expect(savedConfig(agentDir).advisorOutcomeLogging).toBe(true);

      await tool.execute(
        "clear-outcome-logging",
        { action: "update", changes: { advisorOutcomeLogging: null } },
        undefined,
        undefined,
        ctx
      );

      expect(savedConfig(agentDir)).not.toHaveProperty("advisorOutcomeLogging");
      expect(getAdvisorSettings().outcomeLogging).toBe(false);
    });
  });
});
