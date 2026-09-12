import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "../src/commands.ts";
import {
  contextMaxCharsRef,
  loadConfig,
  resetConfigCache,
  setShowUsageDetailsRef,
} from "../src/config.ts";
import { registerAdvisorTool } from "../src/tools.ts";
import { savedConfig, withAgentDir } from "./helpers/config-fixture.ts";
import {
  activationContext,
  activationHarness,
  plainTheme,
} from "./helpers/harness.ts";
import { mockPi } from "./helpers/mock-pi.ts";

initTheme();

const modelsRegistry = (models: Array<{ id: string; provider: string }>) => ({
  find: (provider: string, id: string) =>
    models.find((model) => model.provider === provider && model.id === id),
  getApiKeyAndHeaders: () => Promise.resolve({ apiKey: "key", ok: true }),
  getAvailable: () => models,
});

/** ui.custom that renders the selector, optionally types `search` on the
 * second opening, and submits with Enter. */
const typingSelectorUi = (
  theme: any,
  options: {
    onOpen?: () => void;
    onValue?: (value: string | undefined) => void;
    search?: string;
  } = {}
) => {
  let customCall = 0;
  return {
    custom: (factory: any) =>
      new Promise((resolve) => {
        const selector = factory(
          { requestRender: () => undefined },
          theme,
          { matches: () => false },
          (value: string | undefined) => {
            options.onValue?.(value);
            resolve(value);
          }
        );
        options.onOpen?.();
        selector.render(100);
        if (customCall === 1 && options.search) {
          for (const character of options.search) {
            selector.handleInput(character);
          }
          selector.render(100);
        }
        customCall += 1;
        selector.handleInput("\r");
      }),
    notify: () => undefined,
    select: () => Promise.resolve("✓ Default (Model Default)"),
  };
};

describe("Advisor activation flow", () => {
  test("uses models selected in advisor-models when activating in the same session", async () => {
    await withAgentDir({}, async (agentDir) => {
      const commands = new Map<string, any>();
      let activeTools: string[] = [];
      let selectedModel: unknown;
      const models = [
        { id: "executor", provider: "provider" },
        { id: "advisor", provider: "provider" },
      ];
      const theme = {
        bold: (value: string) => value,
        fg: (_color: string, value: string) => value,
      } as any;
      const ctx = {
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: modelsRegistry(models),
        ui: typingSelectorUi(theme, { search: "advisor" }),
      } as any;

      registerCommands(
        mockPi(
          { commands },
          {
            getActiveTools: () => activeTools,
            setActiveTools(tools: string[]) {
              activeTools = tools;
            },
            setModel(model: unknown) {
              selectedModel = model;
              return Promise.resolve(true);
            },
            setThinkingLevel: () => undefined,
          }
        )
      );
      await commands.get("advisor-models").handler("", ctx);
      expect(savedConfig(agentDir)).toMatchObject({
        advisor: "provider/advisor",
        executor: "provider/executor",
      });

      await commands.get("advisor").handler("", ctx);
      expect(selectedModel).toMatchObject({
        id: "executor",
        provider: "provider",
      });
      expect(activeTools).toContain("ask_advisor");
    });
  });

  test("opens the model picker before first activation", async () => {
    await withAgentDir({}, async (agentDir) => {
      const { commands, pi, setActiveTools } = activationHarness();
      setActiveTools([]);
      const models = [
        { id: "chosen-executor", provider: "provider" },
        { id: "chosen-advisor", provider: "provider" },
      ];
      const selectedModels: string[] = [];
      const notices: string[] = [];
      const ctx = {
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: modelsRegistry(models),
        ui: {
          ...typingSelectorUi(plainTheme, {
            onValue: (value) => {
              if (value) {
                selectedModels.push(value);
              }
            },
            search: "chosen-advisor",
          }),
          notify: (message: string) => notices.push(message),
        },
      } as any;

      registerCommands(pi);
      await commands.get("advisor").handler("", ctx);

      expect(selectedModels).toEqual([
        "provider/chosen-executor",
        "provider/chosen-advisor",
      ]);
      expect(savedConfig(agentDir)).toMatchObject({
        advisor: "provider/chosen-advisor",
        executor: "provider/chosen-executor",
      });
      expect(pi.getActiveTools()).toContain("ask_advisor");
      const explanation = notices.find((message) =>
        message.startsWith("The Advisor is")
      );
      expect(explanation).toContain(
        "The Advisor is a second-opinion model that reviews the Executor's context and returns risks, alternatives, and verification steps without changing files or running tools."
      );
      expect(explanation).toContain("Advisor flow ready");
      expect(notices).toHaveLength(1);
      expect(
        explanation?.split("\n\n")[0].match(/[.!?](?=\s|$)/g)
      ).toHaveLength(1);
    });
  });

  test("keeps available persisted models without opening the picker", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, pi, setActiveTools } = activationHarness();
        setActiveTools([]);
        const models = [
          { id: "executor", provider: "provider" },
          { id: "advisor", provider: "provider" },
        ];
        let customCalls = 0;
        const ctx = {
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry: modelsRegistry(models),
          ui: {
            custom: () => {
              customCalls += 1;
              return Promise.resolve(undefined);
            },
            notify: () => undefined,
          },
        } as any;

        registerCommands(pi);
        await commands.get("advisor").handler("", ctx);

        expect(customCalls).toBe(0);
        expect(pi.getActiveTools()).toContain("ask_advisor");
      }
    );
  });

  test("opens the picker when a persisted model is unavailable", async () => {
    await withAgentDir(
      {
        advisor: "provider/stale",
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, pi } = activationHarness();
        const models = [
          { id: "replacement", provider: "provider" },
          { id: "executor", provider: "provider" },
        ];
        let customCalls = 0;
        const ctx = {
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry: modelsRegistry(models),
          ui: {
            ...typingSelectorUi(plainTheme, {
              onOpen: () => {
                customCalls += 1;
              },
            }),
            select: () => Promise.resolve("✓ Default (Model Default)"),
          },
        } as any;

        registerCommands(pi);
        await commands.get("advisor").handler("", ctx);

        expect(customCalls).toBe(1);
        expect(savedConfig(agentDir)).toMatchObject({
          advisor: "provider/replacement",
          executor: "provider/executor",
        });
        expect(pi.getActiveTools()).toContain("ask_advisor");
      }
    );
  });

  test("cancels first activation without persisting or enabling the flow", async () => {
    await withAgentDir({}, async (agentDir) => {
      const { commands, pi, setActiveTools } = activationHarness();
      setActiveTools([]);
      const ctx = {
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: {
          find: () => undefined,
          getApiKeyAndHeaders: () =>
            Promise.resolve({ apiKey: "key", ok: true }),
          getAvailable: () => [
            { id: "executor", provider: "provider" },
            { id: "advisor", provider: "provider" },
          ],
        },
        ui: {
          custom: () => Promise.resolve(undefined),
          notify: () => undefined,
        },
      } as any;

      registerCommands(pi);
      await commands.get("advisor").handler("", ctx);

      expect(savedConfig(agentDir)).toEqual({});
      expect(pi.getActiveTools()).toEqual([]);
    });
  });

  test("preselects an inactive /model choice in advisor-models", async () => {
    await withAgentDir(
      { advisor: "provider/sonnet", executor: "provider/sonnet" },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = activationHarness();
        const models = [
          { id: "sonnet", provider: "provider" },
          { id: "luna", provider: "provider" },
        ];
        const selectedModels: string[] = [];
        const theme = {
          bold: (value: string) => value,
          fg: (_color: string, value: string) => value,
        } as any;
        const ctx = {
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry: modelsRegistry(models),
          ui: typingSelectorUi(theme, {
            onValue: (value) => {
              if (value) {
                selectedModels.push(value);
              }
            },
            search: "luna",
          }),
        } as any;

        registerCommands(pi);
        setActiveTools([]);
        await events.get("session_start")?.({ reason: "startup" }, ctx);
        events.get("model_select")?.(
          { model: { id: "luna", provider: "provider" }, source: "set" },
          ctx
        );

        await commands.get("advisor-models").handler("", ctx);
        await commands.get("advisor").handler("", ctx);

        expect(selectedModels).toEqual(["provider/luna", "provider/luna"]);
        expect(savedConfig(agentDir)).toMatchObject({
          advisor: "provider/luna",
          executor: "provider/luna",
        });
      }
    );
  });

  test("reports rather than throws when always-on activation fails", async () => {
    await withAgentDir({ alwaysOn: true }, async (agentDir) => {
      writeFileSync(join(agentDir, "advisor.json"), "{ not json");
      resetConfigCache();
      const { events, pi } = activationHarness();
      registerCommands(pi);
      const notes: string[] = [];
      await events.get("session_start")?.(
        { reason: "startup" },
        activationContext(agentDir, notes)
      );
      expect(notes.join("\n")).toContain("Advisor activation failed");
    });
  });

  test("activates silently for always-on sessions but announces /advisor", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        alwaysOn: true,
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = activationHarness();
        registerCommands(pi);
        const automatic: string[] = [];
        setActiveTools([]);
        await events.get("session_start")?.(
          { reason: "startup" },
          activationContext(agentDir, automatic)
        );
        expect(automatic).toEqual([]);
        expect(pi.getActiveTools()).toContain("ask_advisor");

        const manual: string[] = [];
        await commands
          .get("advisor")
          .handler("", activationContext(agentDir, manual));
        expect(manual.join("\n")).toContain("Advisor flow ready");
      }
    );
  });

  test("hides usage details from automatic gate results when disabled", () => {
    setShowUsageDetailsRef(true);
    const { pi, renderers } = activationHarness();
    registerAdvisorTool(pi);
    const render = () =>
      renderers
        .get("advisor-loop-result")(
          {
            content: [{ text: "Decision: proceed", type: "text" }],
            details: {
              advisor: "test/model",
              decision: "proceed",
              text: "Decision: proceed",
              usage: { cost: 0.0042, input: 50, output: 10 },
            },
          },
          { expanded: false },
          plainTheme
        )
        .render(120)
        .join("\n");

    expect(render()).toContain("Usage: ↑50 · ↓10 · $0.0042");
    setShowUsageDetailsRef(false);
    try {
      expect(render()).not.toContain("Usage:");
    } finally {
      setShowUsageDetailsRef(true);
    }
  });

  test("turning the Advisor off also clears persistent activation", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        alwaysOn: true,
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, events, pi } = activationHarness();
        registerCommands(pi);
        const notes: string[] = [];
        const ctx = activationContext(agentDir, notes);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        await commands.get("advisor-off").handler("", ctx);
        expect(pi.getActiveTools()).not.toContain("ask_advisor");
        expect(savedConfig(agentDir).alwaysOn).toBe(false);
        expect(notes.at(-1)).toContain("Always on turned off");
      }
    );
  });

  test("persists context arguments supplied to /advisor", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        contextMaxChars: 15_000,
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, pi } = activationHarness();
        registerCommands(pi);
        await commands
          .get("advisor")
          .handler("contextMaxChars=5000", activationContext(agentDir));
        expect(savedConfig(agentDir).contextMaxChars).toBe(5000);
        expect(loadConfig(activationContext(agentDir))).toBeTruthy();
        expect(contextMaxCharsRef).toBe(5000);
      }
    );
  });

  test("renders a manual sound verdict exactly like the tool response", async () => {
    await withAgentDir({}, () => {
      const { pi, renderers } = activationHarness();
      registerCommands(pi);
      const render = (text: string) =>
        renderers
          .get("advisor-manual-result")(
            {
              content: text,
              details: {
                advisor: "test/model",
                text,
                usage: { cacheWrite: 3, cost: 0.01, input: 100, output: 20 },
              },
            },
            { expanded: true },
            plainTheme
          )
          .render(120)
          .join("\n");
      expect(render("Verdict: sound\n\nNothing to change.")).toContain(
        "◆ ADVISOR · SOUND"
      );
      expect(render("Verdict: sound\n\nNothing to change.")).toContain(
        "Usage: ↑100 · ↓20 · cw:3 · $0.0100"
      );
      setShowUsageDetailsRef(false);
      try {
        expect(render("Verdict: sound\n\nNothing to change.")).not.toContain(
          "Usage:"
        );
      } finally {
        setShowUsageDetailsRef(true);
      }
      expect(render("Consider reverting the migration.")).toContain(
        "◆ ADVISOR RESPONSE"
      );
    });
  });
});
