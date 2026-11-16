import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { initTheme } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";

import { registerCommands } from "../src/commands.ts";
import { ADVISOR_CONFIG_WRITABLE_KEYS } from "../src/commands/configuration-tool-policy.ts";
import { saveAdvisorSettings } from "../src/commands/settings-persistence.ts";
import {
  advisorEffortRef,
  advisorFallbackModelRef,
  advisorRef,
  executorEffortRef,
  executorRef,
  getAdvisorSettings,
  loadConfig,
  validateConfig,
} from "../src/config.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { registerAdvisorTool } from "../src/tools.ts";
import { savedConfig, withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { plainTheme } from "./helpers/harness.ts";
import { mockPi } from "./helpers/mock-pi.ts";
import { changeSetting } from "./helpers/settings-navigation.ts";

initTheme();

const ADVISOR_TOOLS = [
  "ask_advisor",
  "record_advisor_outcome",
  "advisor_config",
];

interface TestModel {
  id: string;
  provider: string;
}

interface TestSessionManager {
  id?: string;
}

interface TestEvent {
  input?: Record<string, never>;
  parentToolCallId?: string;
  reason?: string;
  systemPromptOptions?: { sections: Record<string, string> };
  toolCallId?: string;
  toolName?: string;
}

interface TestAuth {
  apiKey: string;
  ok: boolean;
}

const defaultAuth = (): Promise<TestAuth> =>
  Promise.resolve({ apiKey: "test-key", ok: true });

const harness = (cwd: string, models = ["advisor", "other"]) => {
  const activeTools = ["read", "unrelated_tool", ...ADVISOR_TOOLS];
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const events = new Map<string, ((event: any, ctx: any) => any)[]>();
  const selectedModels: TestModel[] = [];
  const consultedModels: string[] = [];
  const notices: string[] = [];
  const session = new AdvisorSessionState();
  const sessionManager = {};
  const modelList = models.map((id) => ({ id, provider: "provider" }));
  let pickerCount = 0;
  let reasoningChoices = 0;
  let customHandler: ((factory: any) => Promise<any>) | undefined;
  let resolveAuth = defaultAuth;

  const pi = mockPi(
    { activeTools, commands, tools },
    {
      events: { emit: () => undefined },
      on(event: string, handler: (event: any, ctx: any) => any) {
        const handlers = events.get(event) ?? [];

        handlers.push(handler);
        events.set(event, handlers);
      },
      setModel(model: TestModel) {
        selectedModels.push(model);

        return Promise.resolve(true);
      },
      setThinkingLevel: () => undefined,
    }
  );

  registerAdvisorTool(pi, session, {
    consult: async () => {
      consultedModels.push(advisorRef);

      return {
        adviceId: "advice-1",
        markdown: "Review complete.",
        model: advisorRef,
        thinkingText: "",
        trigger: "executor-requested" as const,
      };
    },
  });
  registerCommands(pi, { sessionState: session });

  const context = (manager: TestSessionManager = sessionManager) =>
    asExtensionContext({
      cwd,
      hasUI: true,
      isProjectTrusted: () => false,
      mode: "tui",
      model: { id: "executor", provider: "provider" },
      modelRegistry: {
        find: (provider: string, id: string) =>
          modelList.find(
            (model) => model.provider === provider && model.id === id
          ),
        getApiKeyAndHeaders: () => resolveAuth(),
        getAvailable: () => modelList,
      },
      sessionManager: manager,
      thinkingLevel: "off",
      ui: {
        confirm: () => Promise.resolve(true),
        custom: (factory: any) => {
          if (customHandler) {
            return customHandler(factory);
          }

          return new Promise((resolve) => {
            pickerCount += 1;

            const selector = factory(
              { requestRender: () => undefined },
              plainTheme,
              getKeybindings(),
              resolve
            );

            selector.render(120);
            selector.handleInput("\r");
          });
        },
        notify: (message: string) => notices.push(message),
        select: () => {
          reasoningChoices += 1;

          return Promise.resolve("✓ Default (Model Default)");
        },
        setStatus: () => undefined,
      },
    });

  const fire = async (name: string, event: TestEvent, ctx: any) => {
    const results: unknown[] = [];

    for (const handler of events.get(name) ?? []) {
      results.push(await handler(event, ctx));
    }

    return results;
  };

  return {
    activeTools,
    commands,
    consultedModels,
    context,
    fire,
    get pickerCount() {
      return pickerCount;
    },
    get reasoningChoices() {
      return reasoningChoices;
    },
    notices,
    pi,
    selectedModels,
    session,
    setAuth: (handler: () => Promise<TestAuth>) => {
      resolveAuth = handler;
    },
    setCustom: (handler: (factory: any) => Promise<any>) => {
      customHandler = handler;
    },
    tools,
  };
};

const fileSnapshot = (dir: string) => {
  const path = join(dir, "advisor.json");
  const stats = statSync(path, { bigint: true });

  return {
    bytes: readFileSync(path, "utf-8"),
    ino: stats.ino,
    mtime: stats.mtimeNs,
  };
};

const expectUnchanged = (
  dir: string,
  original: ReturnType<typeof fileSnapshot>
) => {
  expect(fileSnapshot(dir)).toEqual(original);
};

describe("session-scoped Advisor activation", () => {
  test("validates the new global setting and retains the persistent default", async () => {
    await withAgentDir({ futureSetting: { keep: true } }, (dir) => {
      const h = harness(dir);
      const ctx = h.context();
      loadConfig(ctx);
      expect(getAdvisorSettings().advisorActivation).toBe("persistent");
      expect(validateConfig({ advisorActivation: "persistent" })).toBe(true);
      expect(validateConfig({ advisorActivation: "session" })).toBe(true);
      expect(() => validateConfig({ advisorActivation: "invalid" })).toThrow(
        /advisorActivation/u
      );
      expect(ADVISOR_CONFIG_WRITABLE_KEYS).toContain("advisorActivation");
    });
  });

  test("starts all three tools inactive on every session_start, even with Always on", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorActivation: "session",
        advisorHerdrIntegration: false,
        advisorToolsEnabled: false,
        alwaysOn: true,
        futureSetting: { keep: true },
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        const original = fileSnapshot(dir);

        for (const reason of ["startup", "new", "resume", "fork", "reload"]) {
          h.pi.setActiveTools(["read", "unrelated_tool", ...ADVISOR_TOOLS]);
          await h.fire("session_start", { reason }, ctx);
          expect(h.pi.getActiveTools()).toEqual(["read", "unrelated_tool"]);
          expect(h.selectedModels).toEqual([]);
          expectUnchanged(dir, original);

          await h.commands.get("advisor").handler("", ctx);
          expect(h.pi.getActiveTools()).toEqual([
            "read",
            "unrelated_tool",
            ...ADVISOR_TOOLS,
          ]);
          expectUnchanged(dir, original);
        }
      }
    );
  });

  test("allows consultations with a saved opt-out and disables stale calls without saving", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorActivation: "session",
        advisorHerdrIntegration: false,
        advisorToolsEnabled: false,
        alwaysOn: true,
        simpleMode: true,
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        const original = fileSnapshot(dir);
        await h.fire("session_start", { reason: "startup" }, ctx);
        await h.commands.get("advisor").handler("", ctx);

        const sections: Record<string, string> = {};
        await h.fire(
          "before_agent_start",
          { systemPromptOptions: { sections } },
          ctx
        );
        expect(sections.advisor_invocation_settings).toContain(
          "Advisor invocation settings"
        );

        const [guard] = await h.fire(
          "tool_call",
          { input: {}, toolCallId: "ask", toolName: "ask_advisor" },
          ctx
        );

        expect(guard).toBeUndefined();

        const result = await h.tools
          .get("ask_advisor")
          .execute("ask", {}, undefined, undefined, ctx);

        expect(result.structuredContent.text).toBe("Review complete.");
        expect(h.consultedModels).toEqual(["provider/advisor"]);

        await h.commands.get("advisor-off").handler("", ctx);
        expect(h.pi.getActiveTools()).toEqual(["read", "unrelated_tool"]);

        for (const toolName of ADVISOR_TOOLS) {
          const [blocked] = await h.fire(
            "tool_call",
            {
              input: {},
              parentToolCallId: "codemode",
              toolCallId: toolName,
              toolName,
            },
            ctx
          );

          expect(blocked).toMatchObject({ block: true });
        }

        expect(h.notices.join("\n")).toContain("disabled for this session");
        expectUnchanged(dir, original);
      }
    );
  });

  test("keeps picker selections in the current session without creating global settings", async () => {
    await withAgentDir(
      {
        advisorActivation: "session",
        advisorHerdrIntegration: false,
        advisorToolsEnabled: false,
      },
      async (dir) => {
        const h = harness(dir, ["picked"]);
        const ctx = h.context();
        const anotherContext = h.context();
        const original = fileSnapshot(dir);
        await h.fire("session_start", { reason: "startup" }, ctx);
        await h.commands.get("advisor").handler("", ctx);
        expect(h.pickerCount).toBe(2);
        expect(h.pi.getActiveTools()).toContain("ask_advisor");
        expectUnchanged(dir, original);

        loadConfig(anotherContext);
        expect(advisorRef).toBe("provider/picked");

        const result = await h.tools
          .get("ask_advisor")
          .execute("ask", {}, undefined, undefined, anotherContext);

        expect(result.details.advisor).toBe("provider/picked");

        await h.commands.get("advisor-off").handler("", ctx);
        await h.commands.get("advisor").handler("", anotherContext);
        expect(h.pickerCount).toBe(2);
        expectUnchanged(dir, original);

        await h.fire("session_start", { reason: "reload" }, ctx);
        expect(h.pi.getActiveTools()).toEqual(["read", "unrelated_tool"]);
        loadConfig(ctx);
        expect(advisorRef).toBe("");
        expectUnchanged(dir, original);
      }
    );
  });

  test("retains cleared model pins, reasoning levels and fallback after config reloads", async () => {
    await withAgentDir(
      {
        advisor: "provider/missing",
        advisorActivation: "session",
        advisorEffort: "high",
        advisorFallbackModel: "provider/missing",
        advisorHerdrIntegration: false,
        executor: "provider/missing",
        executorEffort: "high",
      },
      async (dir) => {
        const h = harness(dir, ["advisor"]);
        const ctx = h.context();
        const original = fileSnapshot(dir);
        await h.fire("session_start", { reason: "startup" }, ctx);
        await h.commands.get("advisor").handler("", ctx);
        expect(h.pickerCount).toBe(3);
        expectUnchanged(dir, original);

        loadConfig(h.context());
        expect(advisorRef).toBe("provider/advisor");
        expect(advisorEffortRef).toBeUndefined();
        expect(advisorFallbackModelRef).toBeUndefined();
        expect(executorRef).toBe("");
        expect(executorEffortRef).toBeUndefined();

        await h.commands.get("advisor-off").handler("", ctx);
        await h.commands.get("advisor").handler("", ctx);
        expect(h.pickerCount).toBe(3);
        expectUnchanged(dir, original);
      }
    );
  });

  test("keeps command arguments session-local across config loads and unrelated saves", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorActivation: "session",
        advisorHerdrIntegration: false,
        futureSetting: { keep: true },
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        const otherContext = h.context();
        const original = fileSnapshot(dir);
        await h.fire("session_start", { reason: "startup" }, ctx);
        await h.commands
          .get("advisor")
          .handler("advisor=provider/other contextMaxChars=5000", ctx);
        expectUnchanged(dir, original);
        loadConfig(otherContext);
        expect(advisorRef).toBe("provider/other");
        expect(getAdvisorSettings().contextMaxChars).toBe(5000);

        saveAdvisorSettings(
          otherContext,
          { ...getAdvisorSettings(), simpleMode: true },
          { skipOutcomeLogging: true }
        );
        expect(savedConfig(dir)).toMatchObject({
          advisor: "provider/advisor",
          advisorActivation: "session",
          futureSetting: { keep: true },
          simpleMode: true,
        });
        expect(savedConfig(dir)).not.toHaveProperty("contextMaxChars");
        loadConfig(ctx);
        expect(advisorRef).toBe("provider/other");
        expect(getAdvisorSettings().contextMaxChars).toBe(5000);

        await h.commands.get("advisor-models").handler("", ctx);
        expect(savedConfig(dir).advisor).toBe("provider/other");
        expect(savedConfig(dir)).not.toHaveProperty("contextMaxChars");
      }
    );
  });

  test("UI and advisor_config saves preserve session overrides without persisting them", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorActivation: "session",
        advisorHerdrIntegration: false,
        futureSetting: { keep: true },
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        const original = fileSnapshot(dir);
        await h.fire("session_start", { reason: "startup" }, ctx);
        await h.commands
          .get("advisor")
          .handler("advisor=provider/other contextMaxChars=5000", ctx);
        expectUnchanged(dir, original);

        h.setCustom(
          (factory: any) =>
            new Promise<void>((resolve) => {
              const selector = factory(
                { requestRender: () => undefined },
                plainTheme,
                getKeybindings(),
                resolve
              );

              changeSetting(selector, "Simple mode");
              selector.dispose();
              resolve();
            })
        );
        await h.commands.get("advisor-settings").handler("", ctx);

        const result = await h.tools
          .get("advisor_config")
          .execute(
            "save-gate",
            { action: "update", changes: { advisorPlanGate: false } },
            undefined,
            undefined,
            ctx
          );

        expect(result.details).toMatchObject({ applied: true });
        expect(savedConfig(dir)).toMatchObject({
          advisor: "provider/advisor",
          advisorPlanGate: false,
          futureSetting: { keep: true },
          simpleMode: true,
        });
        expect(savedConfig(dir)).not.toHaveProperty("contextMaxChars");
        loadConfig(h.context());
        expect(advisorRef).toBe("provider/other");
        expect(getAdvisorSettings().contextMaxChars).toBe(5000);

        const afterExplicitSaves = fileSnapshot(dir);
        await h.commands.get("advisor-off").handler("", ctx);
        await h.commands.get("advisor").handler("", ctx);
        expect(advisorRef).toBe("provider/other");
        expectUnchanged(dir, afterExplicitSaves);
        await h.fire("session_start", { reason: "reload" }, ctx);
        expect(advisorRef).toBe("provider/advisor");
        expect(getAdvisorSettings().contextMaxChars).toBe(15_000);
        expectUnchanged(dir, afterExplicitSaves);
      }
    );
  });

  test("does not leak session overrides to another session manager", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorActivation: "session",
        advisorHerdrIntegration: false,
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        await h.fire("session_start", { reason: "startup" }, ctx);
        await h.commands.get("advisor").handler("advisor=provider/other", ctx);
        loadConfig(h.context({}));
        expect(advisorRef).toBe("provider/advisor");
        loadConfig(ctx);
        expect(advisorRef).toBe("provider/other");
      }
    );
  });

  test("restores the current toggle after tree navigation and keeps a recorded block", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorActivation: "session",
        advisorHerdrIntegration: false,
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        await h.fire("session_start", { reason: "startup" }, ctx);
        await h.commands.get("advisor").handler("", ctx);
        h.pi.setActiveTools(["read", "unrelated_tool"]);
        await h.fire("session_tree", {}, ctx);
        expect(h.pi.getActiveTools()).toEqual([
          "read",
          "unrelated_tool",
          ...ADVISOR_TOOLS,
        ]);

        h.session.block("existing safety block");
        await h.commands.get("advisor-off").handler("", ctx);
        h.pi.setActiveTools(["read", "unrelated_tool", ...ADVISOR_TOOLS]);
        await h.fire("session_tree", {}, ctx);
        expect(h.pi.getActiveTools()).toEqual(["read", "unrelated_tool"]);

        const [blocked] = await h.fire(
          "tool_call",
          { input: {}, toolCallId: "read", toolName: "read" },
          ctx
        );

        expect(blocked).toMatchObject({
          block: true,
          reason: "existing safety block",
        });
      }
    );
  });

  test("an unrelated settings change does not enable inactive session tools", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorActivation: "session",
        advisorHerdrIntegration: false,
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        await h.fire("session_start", { reason: "startup" }, ctx);
        h.setCustom(
          (factory: any) =>
            new Promise<void>((resolve) => {
              const selector = factory(
                { requestRender: () => undefined },
                plainTheme,
                getKeybindings(),
                resolve
              );

              changeSetting(selector, "Simple mode");
              selector.dispose();
              resolve();
            })
        );
        await h.commands.get("advisor-settings").handler("", ctx);
        expect(savedConfig(dir).simpleMode).toBe(true);
        expect(h.pi.getActiveTools()).toEqual(["read", "unrelated_tool"]);
      }
    );
  });

  test("saving Always on does not activate an inactive session", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorActivation: "session",
        advisorHerdrIntegration: false,
        advisorToolsEnabled: false,
        alwaysOn: false,
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        await h.fire("session_start", { reason: "startup" }, ctx);
        h.setCustom(
          (factory: any) =>
            new Promise<void>((resolve) => {
              const selector = factory(
                { requestRender: () => undefined },
                plainTheme,
                getKeybindings(),
                resolve
              );

              changeSetting(selector, "Always on");
              selector.dispose();
              resolve();
            })
        );
        await h.commands.get("advisor-settings").handler("", ctx);
        expect(savedConfig(dir)).toMatchObject({
          advisorToolsEnabled: true,
          alwaysOn: true,
        });
        expect(h.pi.getActiveTools()).toEqual(["read", "unrelated_tool"]);
      }
    );
  });

  test("config tool updates the scope without changing the current tool state", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorHerdrIntegration: false,
        alwaysOn: true,
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        loadConfig(ctx);
        const configTool = h.tools.get("advisor_config");

        const result = await configTool.execute(
          "scope",
          { action: "update", changes: { advisorActivation: "session" } },
          undefined,
          undefined,
          ctx
        );

        expect(result.details).toMatchObject({ applied: true });
        expect(savedConfig(dir)).toMatchObject({
          advisorActivation: "session",
          alwaysOn: true,
        });
        expect(h.pi.getActiveTools()).toEqual([
          "read",
          "unrelated_tool",
          ...ADVISOR_TOOLS,
        ]);

        const original = fileSnapshot(dir);
        await h.commands.get("advisor-off").handler("", ctx);
        expect(h.pi.getActiveTools()).toEqual(["read", "unrelated_tool"]);
        expectUnchanged(dir, original);
      }
    );
  });

  test("mode changes keep an inactive flow off and restore the configuration tool", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorHerdrIntegration: false,
        advisorToolsEnabled: false,
        futureSetting: { keep: true },
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        await h.fire("session_start", { reason: "startup" }, ctx);
        expect(h.pi.getActiveTools()).toEqual([
          "read",
          "unrelated_tool",
          "advisor_config",
        ]);

        const result = await h.tools
          .get("advisor_config")
          .execute(
            "scope",
            { action: "update", changes: { advisorActivation: "session" } },
            undefined,
            undefined,
            ctx
          );

        expect(result.details).toMatchObject({ applied: true });
        expect(h.pi.getActiveTools()).toEqual(["read", "unrelated_tool"]);

        h.setCustom(
          (factory: any) =>
            new Promise<void>((resolve) => {
              const selector = factory(
                { requestRender: () => undefined },
                plainTheme,
                getKeybindings(),
                resolve
              );

              changeSetting(selector, "Advisor activation");
              selector.dispose();
              resolve();
            })
        );
        await h.commands.get("advisor-settings").handler("", ctx);
        expect(savedConfig(dir)).toMatchObject({
          advisorActivation: "persistent",
          advisorToolsEnabled: false,
          futureSetting: { keep: true },
        });
        expect(h.pi.getActiveTools()).toEqual([
          "read",
          "unrelated_tool",
          "advisor_config",
        ]);
      }
    );
  });

  test("switching back to persistent mode applies the saved preference", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorActivation: "session",
        advisorHerdrIntegration: false,
        advisorToolsEnabled: false,
        futureSetting: { keep: true },
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        await h.fire("session_start", { reason: "startup" }, ctx);
        await h.commands.get("advisor").handler("", ctx);
        h.setCustom(
          (factory: any) =>
            new Promise<void>((resolve) => {
              const selector = factory(
                { requestRender: () => undefined },
                plainTheme,
                getKeybindings(),
                resolve
              );

              changeSetting(selector, "Advisor activation");
              selector.dispose();
              resolve();
            })
        );
        await h.commands.get("advisor-settings").handler("", ctx);
        expect(savedConfig(dir)).toMatchObject({
          advisorActivation: "persistent",
          advisorToolsEnabled: false,
          futureSetting: { keep: true },
        });
        expect(h.pi.getActiveTools()).toEqual([
          "read",
          "unrelated_tool",
          "advisor_config",
        ]);
      }
    );
  });

  test("switching an inactive session to persistent mode restores an enabled preference", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorActivation: "session",
        advisorHerdrIntegration: false,
        advisorToolsEnabled: true,
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        await h.fire("session_start", { reason: "startup" }, ctx);
        h.setCustom(
          (factory: any) =>
            new Promise<void>((resolve) => {
              const selector = factory(
                { requestRender: () => undefined },
                plainTheme,
                getKeybindings(),
                resolve
              );

              changeSetting(selector, "Advisor activation");
              selector.dispose();
              resolve();
            })
        );
        await h.commands.get("advisor-settings").handler("", ctx);
        expect(savedConfig(dir).advisorActivation).toBe("persistent");
        expect(h.pi.getActiveTools().toSorted()).toEqual(
          ["read", "unrelated_tool", ...ADVISOR_TOOLS].toSorted()
        );
      }
    );
  });

  test("a cancelled model picker leaves the session off and configuration untouched", async () => {
    await withAgentDir(
      { advisorActivation: "session", advisorHerdrIntegration: false },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        const original = fileSnapshot(dir);
        await h.fire("session_start", { reason: "startup" }, ctx);
        h.setCustom(() => Promise.resolve());
        await h.commands.get("advisor").handler("", ctx);
        expect(h.pi.getActiveTools()).toEqual(["read", "unrelated_tool"]);
        expectUnchanged(dir, original);
      }
    );
  });

  test.each(["off", "new-session"] as const)(
    "a pending model picker cannot reactivate after %s",
    async (transition) => {
      await withAgentDir(
        { advisorActivation: "session", advisorHerdrIntegration: false },
        async (dir) => {
          const h = harness(dir);
          const ctx = h.context();
          const original = fileSnapshot(dir);
          await h.fire("session_start", { reason: "startup" }, ctx);
          let finishPicker!: (value: string) => void;
          let announcePicker!: () => void;
          let opened = 0;

          const pickerOpened = new Promise<void>((resolve) => {
            announcePicker = resolve;
          });

          h.setCustom(() => {
            opened += 1;

            if (opened > 1) {
              return Promise.resolve("Disabled (no fallback)");
            }

            announcePicker();

            return new Promise((resolve) => {
              finishPicker = resolve;
            });
          });

          const activation = h.commands.get("advisor").handler("", ctx);
          await pickerOpened;

          if (transition === "off") {
            await h.commands.get("advisor-off").handler("", ctx);
          } else {
            await h.fire("session_shutdown", { reason: "new" }, ctx);
            await h.fire("session_start", { reason: "new" }, h.context({}));
          }

          finishPicker("provider/advisor");
          await activation;
          expect(h.reasoningChoices).toBe(0);
          expect(advisorRef).toBe("");
          expect(h.pi.getActiveTools()).toEqual(["read", "unrelated_tool"]);
          expectUnchanged(dir, original);
        }
      );
    }
  );

  test("session shutdown invalidates an in-flight activation", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorActivation: "session",
        advisorHerdrIntegration: false,
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        const original = fileSnapshot(dir);
        await h.fire("session_start", { reason: "startup" }, ctx);
        let release!: (value: TestAuth) => void;
        let started!: () => void;

        const authStarted = new Promise<void>((resolve) => {
          started = resolve;
        });

        h.setAuth(() => {
          started();

          return new Promise((resolve) => {
            release = resolve;
          });
        });

        const activation = h.commands.get("advisor").handler("", ctx);
        await authStarted;
        await h.fire("session_shutdown", { reason: "reload" }, ctx);
        release({ apiKey: "test-key", ok: true });
        await activation;
        expect(h.pi.getActiveTools()).toEqual(["read", "unrelated_tool"]);
        expectUnchanged(dir, original);
      }
    );
  });

  test("/advisor-off cancels an in-flight activation without writing", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorActivation: "session",
        advisorHerdrIntegration: false,
      },
      async (dir) => {
        const h = harness(dir);
        const ctx = h.context();
        const original = fileSnapshot(dir);
        await h.fire("session_start", { reason: "startup" }, ctx);
        let release!: (value: { apiKey: string; ok: boolean }) => void;
        let started!: () => void;

        const authStarted = new Promise<void>((resolve) => {
          started = resolve;
        });

        h.setAuth(() => {
          started();

          return new Promise((resolve) => {
            release = resolve;
          });
        });

        const activation = h.commands
          .get("advisor")
          .handler("advisor=provider/other", ctx);

        await authStarted;
        await h.commands.get("advisor-off").handler("", ctx);
        release({ apiKey: "test-key", ok: true });
        await activation;
        expect(h.pi.getActiveTools()).toEqual(["read", "unrelated_tool"]);
        expectUnchanged(dir, original);
      }
    );
  });
});
