import { describe, expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  effectiveExecutorEffort,
  effectiveExecutorRef,
} from "../src/child-session.ts";
import { registerCommands } from "../src/commands.ts";
import { loadConfig } from "../src/config.ts";
import { savedConfig, withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import {
  activationContext,
  activationHarness,
  plainTheme,
} from "./helpers/harness.ts";

const sessionModel = { id: "session", provider: "omp" };

describe("Executor follows the session model", () => {
  test("activation keeps the session model when no Executor is configured", async () => {
    await withAgentDir({ advisor: "provider/advisor" }, async (agentDir) => {
      const { commands, events, pi, selectedModels, setActiveTools } =
        activationHarness();

      registerCommands(pi);
      setActiveTools([]);
      const notes: string[] = [];
      const ctx = activationContext(agentDir, notes);
      await events.get("session_start")?.({ reason: "startup" }, ctx);

      await commands.get("advisor").handler("", ctx);

      expect(selectedModels).toEqual([]);
      expect(pi.getActiveTools()).toContain("ask_advisor");
      expect(savedConfig(agentDir)).not.toHaveProperty("executor");
      expect(notes.join("\n")).not.toContain("not configured");
    });
  });

  test("a /model selection is not persisted as the Executor", async () => {
    await withAgentDir({ advisor: "provider/advisor" }, async (agentDir) => {
      const { commands, events, pi, selectedModels, setActiveTools } =
        activationHarness();

      registerCommands(pi);
      setActiveTools([]);
      const ctx = activationContext(agentDir);
      await events.get("session_start")?.({ reason: "startup" }, ctx);

      events.get("model_select")?.(
        { model: { id: "luna", provider: "provider" }, source: "set" },
        ctx
      );
      await commands.get("advisor").handler("", ctx);
      events.get("model_select")?.(
        { model: { id: "sol", provider: "provider" }, source: "set" },
        ctx
      );

      expect(selectedModels).toEqual([]);
      expect(savedConfig(agentDir)).not.toHaveProperty("executor");
    });
  });

  test("an explicit /advisor executor override still switches models", async () => {
    await withAgentDir({ advisor: "provider/advisor" }, async (agentDir) => {
      const { commands, events, pi, selectedModels, setActiveTools } =
        activationHarness();

      registerCommands(pi);
      setActiveTools([]);
      const ctx = activationContext(agentDir);
      await events.get("session_start")?.({ reason: "startup" }, ctx);

      await commands.get("advisor").handler("executor=provider/pinned", ctx);

      expect(selectedModels).toEqual([{ id: "pinned", provider: "provider" }]);
      expect(savedConfig(agentDir).executor).toBe("provider/pinned");
    });
  });

  test("effective Executor resolves to the session model unless configured", async () => {
    await withAgentDir({}, async (agentDir) => {
      const ctx = asExtensionContext({
        cwd: agentDir,
        isProjectTrusted: () => false,
        model: sessionModel,
        thinkingLevel: "high",
      });

      loadConfig(ctx);
      expect(effectiveExecutorRef(ctx)).toBe("omp/session");
      expect(effectiveExecutorEffort(ctx)).toBe("high");
    });
    await withAgentDir(
      { executor: "provider/pinned", executorEffort: "low" },
      async (agentDir) => {
        const ctx = asExtensionContext({
          cwd: agentDir,
          isProjectTrusted: () => false,
          model: sessionModel,
          thinkingLevel: "high",
        });

        loadConfig(ctx);
        expect(effectiveExecutorRef(ctx)).toBe("provider/pinned");
        expect(effectiveExecutorEffort(ctx)).toBe("low");
      }
    );
  });
});

const select = (events: Map<string, any>, ctx: ExtensionContext, id: string) =>
  events.get("model_select")?.(
    { model: { id, provider: "provider" }, source: "set" },
    ctx
  );

describe("Executor pin transitions within one session", () => {
  test("clearing the pin in /advisor-models stops /model from re-pinning", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", executor: "provider/pinned" },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = activationHarness();
        registerCommands(pi);
        setActiveTools([]);

        const models = [
          { id: "advisor", provider: "provider" },
          { id: "pinned", provider: "provider" },
        ];

        let opened = 0;

        const ctx = asExtensionContext({
          ...activationContext(agentDir, [], models),
          ui: {
            custom: (factory: any) =>
              new Promise((resolve) => {
                const selector = factory(
                  { requestRender: () => {} },
                  plainTheme,
                  { matches: () => false },
                  resolve
                );

                selector.render(100);

                if (opened === 0) {
                  for (const character of "Current session") {
                    selector.handleInput(character);
                  }

                  selector.render(100);
                }

                opened += 1;
                selector.handleInput("\r");
              }),
            notify: () => {},
            select: () => Promise.resolve("✓ Default (Model Default)"),
          },
        });

        await events.get("session_start")?.({ reason: "startup" }, ctx);
        await commands.get("advisor").handler("", ctx);

        await commands.get("advisor-models").handler("", ctx);
        expect(savedConfig(agentDir)).not.toHaveProperty("executor");

        select(events, ctx, "other");
        expect(savedConfig(agentDir)).not.toHaveProperty("executor");
      }
    );
  });

  test("pinning via /advisor executor= survives later /model selections", async () => {
    await withAgentDir({ advisor: "provider/advisor" }, async (agentDir) => {
      const { commands, events, pi, setActiveTools } = activationHarness();
      registerCommands(pi);
      setActiveTools([]);
      const ctx = activationContext(agentDir);
      await events.get("session_start")?.({ reason: "startup" }, ctx);
      await commands.get("advisor").handler("", ctx);

      await commands.get("advisor").handler("executor=provider/pinned", ctx);
      expect(savedConfig(agentDir).executor).toBe("provider/pinned");

      select(events, ctx, "luna");
      expect(savedConfig(agentDir).executor).toBe("provider/pinned");
    });
  });
});
