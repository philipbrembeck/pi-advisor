import { describe, expect, test } from "bun:test";
import { registerCommands } from "../src/commands.ts";
import { savedConfig, withAgentDir } from "./helpers/config-fixture.ts";
import { activationContext, activationHarness } from "./helpers/harness.ts";

describe("Executor model adoption", () => {
  test("only an explicit model selection redefines the persisted Executor", async () => {
    await withAgentDir(
      { executor: "configured/executor" },
      async (agentDir) => {
        const { events, pi } = activationHarness();
        registerCommands(pi);
        const ctx = activationContext(agentDir);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        for (const source of ["restore", "cycle"] as const) {
          events.get("model_select")?.(
            { model: { id: "other", provider: "vendor" }, source },
            ctx
          );
          expect(savedConfig(agentDir).executor).toBe("configured/executor");
        }

        events.get("model_select")?.(
          { model: { id: "chosen", provider: "vendor" }, source: "set" },
          ctx
        );
        expect(savedConfig(agentDir).executor).toBe("vendor/chosen");
      }
    );
  });

  test("adopts an explicit model selection made before activation", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", executor: "configured/executor" },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = activationHarness();
        registerCommands(pi);
        setActiveTools([]);
        const ctx = activationContext(agentDir);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        events.get("model_select")?.(
          { model: { id: "luna", provider: "provider" }, source: "set" },
          ctx
        );
        // Keep normal `/model` changes out of global config until activation
        // succeeds.
        expect(savedConfig(agentDir).executor).toBe("configured/executor");

        await commands.get("advisor").handler("", ctx);

        expect(savedConfig(agentDir)).toMatchObject({
          advisor: "provider/advisor",
          executor: "provider/luna",
        });
        expect(pi.getActiveTools()).toContain("ask_advisor");
      }
    );
  });

  test("an explicit /advisor Executor override wins over an inactive selection", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", executor: "configured/executor" },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = activationHarness();
        registerCommands(pi);
        setActiveTools([]);
        const ctx = activationContext(agentDir);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        events.get("model_select")?.(
          { model: { id: "luna", provider: "provider" }, source: "set" },
          ctx
        );
        await commands
          .get("advisor")
          .handler("executor=provider/explicit", ctx);

        expect(savedConfig(agentDir).executor).toBe("provider/explicit");
      }
    );
  });

  test("does not adopt restored or cycled models on activation", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", executor: "configured/executor" },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = activationHarness();
        registerCommands(pi);
        setActiveTools([]);
        const ctx = activationContext(agentDir);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        for (const source of ["restore", "cycle"] as const) {
          events.get("model_select")?.(
            { model: { id: "other", provider: "provider" }, source },
            ctx
          );
        }
        await commands.get("advisor").handler("", ctx);

        expect(savedConfig(agentDir).executor).toBe("configured/executor");
        expect(pi.getActiveTools()).toContain("ask_advisor");
      }
    );
  });

  test("keeps an inactive model selection out of config until activation", async () => {
    await withAgentDir({ executor: "configured/executor" }, (agentDir) => {
      const { events, pi, setActiveTools } = activationHarness();
      registerCommands(pi);
      setActiveTools([]);
      events.get("model_select")?.(
        { model: { id: "chosen", provider: "vendor" }, source: "set" },
        activationContext(agentDir)
      );
      expect(savedConfig(agentDir).executor).toBe("configured/executor");
    });
  });
});
