import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  registerFauxProvider,
} from "@earendil-works/pi-ai/compat";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { BeforeAgentStartEvent } from "@earendil-works/pi-coding-agent";

import registerExtension, {
  consultAdvisor,
  runAdvisorGate,
} from "../extensions/index.ts";
import {
  setAdvisorRedactSecretsRef,
  setAdvisorScoutEnabledRef,
  setAdvisorToolPoliciesRef,
} from "../src/config.ts";
import { setAdvisorScoutTimeoutMsRef } from "../src/config/state.ts";
import { loadConfig } from "../src/config/storage.ts";
import { DEFAULT_SCOUT_TIMEOUT_MS } from "../src/config/types.ts";
import { HerdrAdvisorBlock } from "../src/herdr-block.ts";
import { herdrAdvisorActivity } from "../src/herdr.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { advisorRequestConversation } from "../src/tools.ts";
import { handleAutomaticGate } from "../src/tools/loop-gate.ts";
import { ScoutStatusManager } from "../src/tools/scout-status.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { mockPi } from "./helpers/mock-pi.ts";

type PromptSections = BeforeAgentStartEvent["systemPromptOptions"]["sections"];

const fauxContext = (
  cwd: string,
  faux: any,
  entries: object[] = [],
  trusted = false
) =>
  asExtensionContext({
    cwd,
    isProjectTrusted: () => trusted,
    modelRegistry: {
      find: () => faux.models[0],
      getApiKeyAndHeaders: () => Promise.resolve({ apiKey: "key", ok: true }),
    },
    sessionManager: {
      buildContextEntries: () => entries,
      getBranch: () => entries,
    },
  });

describe("Advisor consultation request construction", () => {
  test("forwards trusted project and global AGENTS.md context with byte accounting", async () => {
    const captured: string[] = [];

    const faux = registerFauxProvider({
      api: "pi-advisor-agents-context-test",
      models: [{ id: "advisor", input: ["text"] }],
      provider: "pi-advisor-agents-context-test",
    });

    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-agents-context-test/advisor",
          advisorAgentsMdContext: true,
          advisorGitContext: "off",
        },
        async (agentDir) => {
          const project = mkdtempSync(join(tmpdir(), "pi-advisor-project-"));
          writeFileSync(join(project, "AGENTS.md"), "project conventions");
          writeFileSync(join(agentDir, "AGENTS.md"), "global conventions");

          try {
            faux.setResponses([
              (context) => {
                captured.push(JSON.stringify(context.messages));

                return fauxAssistantMessage("Advice");
              },
            ]);

            const result = await consultAdvisor(
              fauxContext(project, faux, [], true)
            );

            expect(captured[0]).toContain("<project_rules");
            expect(captured[0]).toContain("[project AGENTS.md]");
            expect(captured[0]).toContain("[global AGENTS.md]");
            expect(result.agentRulesBytes).toBeGreaterThan(0);
          } finally {
            rmSync(project, { force: true, recursive: true });
          }
        }
      );
    } finally {
      faux.unregister();
    }
  });

  test("omits AGENTS.md context when the setting is disabled", async () => {
    const captured: string[] = [];

    const faux = registerFauxProvider({
      api: "pi-advisor-agents-disabled-test",
      models: [{ id: "advisor", input: ["text"] }],
      provider: "pi-advisor-agents-disabled-test",
    });

    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-agents-disabled-test/advisor",
          advisorAgentsMdContext: false,
          advisorGitContext: "off",
        },
        async (agentDir) => {
          const project = mkdtempSync(join(tmpdir(), "pi-advisor-project-"));
          writeFileSync(join(project, "AGENTS.md"), "project conventions");
          writeFileSync(join(agentDir, "AGENTS.md"), "global conventions");

          try {
            faux.setResponses([
              (context) => {
                captured.push(JSON.stringify(context.messages));

                return fauxAssistantMessage("Advice");
              },
            ]);

            const result = await consultAdvisor(
              fauxContext(project, faux, [], true)
            );

            expect(captured[0]).not.toContain("<project_rules");
            expect(result.agentRulesBytes).toBeUndefined();
          } finally {
            rmSync(project, { force: true, recursive: true });
          }
        }
      );
    } finally {
      faux.unregister();
    }
  });

  test("applies redaction at the Advisor request-context boundary", () => {
    const secret = "AKIAABCDEFGHIJKLMNOP";

    const ctx = asExtensionContext({
      sessionManager: {
        getBranch: () => [
          {
            message: { content: `api_key=${secret}`, role: "user" },
            type: "message",
          },
          {
            message: {
              content: secret,
              role: "toolResult",
              toolName: "custom",
            },
            type: "message",
          },
        ],
      },
    });

    setAdvisorRedactSecretsRef(true);
    setAdvisorToolPoliciesRef({});

    try {
      const context = advisorRequestConversation(ctx);
      expect(context).not.toContain(secret);
      expect(context).toContain("[REDACTED SECRET]");
    } finally {
      setAdvisorRedactSecretsRef(false);
      setAdvisorToolPoliciesRef({});
    }
  });

  test("fails automatic gates closed for terminal provider failures", async () => {
    const faux = registerFauxProvider({
      api: "pi-advisor-gate-test",
      models: [{ id: "advisor", input: ["text"] }],
      provider: "pi-advisor-gate-test",
    });

    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-gate-test/advisor",
          advisorGitContext: "off",
        },
        async (agentDir) => {
          faux.setResponses([
            () =>
              fauxAssistantMessage("Decision: proceed", {
                errorMessage: "provider unavailable",
                stopReason: "error",
              }),
            () =>
              fauxAssistantMessage("Decision: proceed", {
                errorMessage: "provider aborted",
                stopReason: "aborted",
              }),
          ]);
          const context = fauxContext(agentDir, faux);

          const outcomes = await Promise.all([
            runAdvisorGate(context, "Review the repeated action."),
            runAdvisorGate(context, "Review the repeated action."),
          ]);

          expect(outcomes).toMatchObject([
            {
              category: "provider-error",
              message: "provider unavailable",
              ok: false,
            },
            {
              category: "provider-error",
              message: "provider aborted",
              ok: false,
            },
          ]);
        }
      );
    } finally {
      faux.unregister();
    }
  });

  test("blocks repeated tool calls when registry auth fails in the gate", async () => {
    const previousEnvValue = process.env.PI_ADVISOR_TEST_MISSING_GATE_KEY;
    delete process.env.PI_ADVISOR_TEST_MISSING_GATE_KEY;
    const notifications: string[] = [];
    const blockedEvents: boolean[] = [];

    try {
      await withAgentDir(
        {
          advisor: "provider/advisor",
          advisorAutoLoopGate: true,
          advisorGitContext: "off",
          advisorLoopThreshold: 2,
          advisorScoutEnabled: false,
          gateFailureMode: "block-session",
        },
        async (agentDir) => {
          const runtime = await ModelRuntime.create({
            credentials: new InMemoryCredentialStore(),
            modelsPath: null,
            refreshOnCreate: false,
          });

          const registry = new ModelRegistry(runtime);
          let providerCalled = false;
          registry.registerProvider("provider", {
            api: "test-api",
            apiKey: "$PI_ADVISOR_TEST_MISSING_GATE_KEY",
            models: [
              {
                api: "test-api",
                baseUrl: "https://example.test",
                contextWindow: 1000,
                cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
                id: "executor",
                input: ["text"],
                maxTokens: 100,
                name: "Executor",
                reasoning: false,
              },
              {
                api: "test-api",
                baseUrl: "https://example.test",
                contextWindow: 1000,
                cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
                id: "advisor",
                input: ["text"],
                maxTokens: 100,
                name: "Advisor",
                reasoning: true,
              },
            ],
            streamSimple: () => {
              providerCalled = true;
              throw new Error("Provider wrapper should not run without auth.");
            },
          });
          const executor = registry.find("provider", "executor");

          if (!executor) {
            throw new Error("Test Executor model was not registered.");
          }

          const context = asExtensionContext({
            abort: () => {},
            cwd: agentDir,
            hasUI: true,
            isProjectTrusted: () => false,
            mode: "json",
            model: executor,
            modelRegistry: registry,
            sessionManager: {
              buildContextEntries: () => [],
              getBranch: () => [],
            },
            ui: {
              notify: (message: string) => notifications.push(message),
              setStatus: () => {},
            },
          });

          loadConfig(context);
          const session = new AdvisorSessionState();
          const sent: { message: any; options: any }[] = [];
          const pi = mockPi({ sent });

          const herdrBlock = new HerdrAdvisorBlock(
            () => {},
            () => true,
            (active) => blockedEvents.push(active)
          );

          const event = {
            input: { command: "echo repeated" },
            toolName: "bash" as const,
            type: "tool_call" as const,
          };

          const runGate = (toolCallId: string) =>
            handleAutomaticGate(
              pi,
              { ...event, toolCallId },
              context,
              session,
              runAdvisorGate,
              new ScoutStatusManager(false),
              herdrAdvisorActivity.createScope(),
              herdrBlock
            );

          expect(await runGate("first-gate-call")).toBeUndefined();
          const effect = await runGate("second-gate-call");
          expect(effect).toMatchObject({
            block: true,
            reason: expect.stringContaining("Advisor gate provider-error"),
          });
          expect(session.blocked).toBe(true);
          expect(blockedEvents).toEqual([true]);
          expect(notifications[0]).toContain(
            "Advisor gate failure; session blocked"
          );
          expect(
            sent.some(({ message }) =>
              message.content.includes("Advisor gate failure (provider-error)")
            )
          ).toBe(true);
          expect(providerCalled).toBe(false);
        }
      );
    } finally {
      if (previousEnvValue === undefined) {
        delete process.env.PI_ADVISOR_TEST_MISSING_GATE_KEY;
      } else {
        process.env.PI_ADVISOR_TEST_MISSING_GATE_KEY = previousEnvValue;
      }
    }
  });

  test("redacts targeted questions before the provider request", async () => {
    const captured: string[] = [];

    const faux = registerFauxProvider({
      api: "pi-advisor-redaction-test",
      models: [{ id: "advisor", input: ["text"] }],
      provider: "pi-advisor-redaction-test",
    });

    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-redaction-test/advisor",
          advisorGitContext: "off",
          advisorRedactSecrets: true,
        },
        async (agentDir) => {
          faux.setResponses([
            (context) => {
              captured.push(JSON.stringify(context.messages));

              return fauxAssistantMessage("Advice");
            },
          ]);

          const result = await consultAdvisor(
            fauxContext(agentDir, faux),
            "password=hunter2"
          );

          expect(result.markdown).toBe("Advice");
        }
      );
    } finally {
      faux.unregister();
    }

    expect(captured).toHaveLength(1);
    expect(captured[0]).not.toContain("hunter2");
    expect(captured[0]).toContain("[REDACTED SECRET]");
  });

  test("completes the Advisor call with legacy context after a real Scout timeout", async () => {
    const faux = registerFauxProvider({
      api: "pi-advisor-scout-timeout-test",
      models: [{ id: "advisor", input: ["text"] }],
      provider: "pi-advisor-scout-timeout-test",
    });

    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-scout-timeout-test/advisor",
          advisorGitContext: "off",
          advisorScoutEnabled: true,
          advisorScoutTimeoutMs: 20,
          executor: "pi-advisor-scout-timeout-test/advisor",
        },
        async (agentDir) => {
          const entries = [
            {
              id: "user-entry",
              message: {
                content: "Original context should remain available.",
                role: "user",
              },
              parentId: null,
              timestamp: "2026-01-01T00:00:00Z",
              type: "message",
            },
          ];

          let advisorRequest = "";
          faux.setResponses([
            (_context, options) =>
              new Promise((resolve, reject) => {
                const signal = options?.signal;

                if (!signal) {
                  reject(new Error("Scout response must be abortable"));

                  return;
                }

                const complete = () =>
                  resolve(
                    fauxAssistantMessage('{"selectedIds":[],"synthesis":""}')
                  );

                if (signal.aborted) {
                  complete();
                } else {
                  signal.addEventListener("abort", complete, { once: true });
                }
              }),
            (context) => {
              advisorRequest = JSON.stringify(context.messages);

              return fauxAssistantMessage(
                "Advisor completed after Scout timeout."
              );
            },
          ]);
          const scoutFallbacks: string[] = [];

          const result = await consultAdvisor(
            fauxContext(agentDir, faux, entries),
            "Continue with the original conversation.",
            undefined,
            undefined,
            "executor-requested",
            undefined,
            undefined,
            undefined,
            undefined,
            (event) => {
              if (event.type === "fallback") {
                scoutFallbacks.push(event.outcome.message);
              }
            }
          );

          expect(result.markdown).toBe(
            "Advisor completed after Scout timeout."
          );
          expect(result.scout).toMatchObject({
            category: "timeout",
            message: "Scout timed out after 20 ms.",
            ok: false,
          });
          expect(scoutFallbacks).toEqual(["Scout timed out after 20 ms."]);
          expect(advisorRequest).toContain(
            "User: Original context should remain available."
          );
          expect(faux.state.callCount).toBe(2);
        }
      );
    } finally {
      faux.unregister();
      setAdvisorScoutEnabledRef(false);
      setAdvisorScoutTimeoutMsRef(DEFAULT_SCOUT_TIMEOUT_MS);
    }
  });

  test("injects only the enabled invocation rules into the active prompt", async () => {
    await withAgentDir(
      {
        advisorCompletionGate: false,
        advisorCustomInvocation: "a deployment changes production data",
        advisorFailureGate: true,
        advisorPlanGate: false,
      },
      () => {
        let beforeAgentStart: any;
        registerExtension(
          mockPi(
            { activeTools: ["ask_advisor"] },
            {
              on(event: string, handler: any) {
                if (event === "before_agent_start") {
                  beforeAgentStart = handler;
                }
              },
              registerTool: () => {},
            }
          )
        );

        const sections: PromptSections = {
          mcp_servers: "<mcp_servers>servers</mcp_servers>",
        };

        const result = beforeAgentStart(
          { systemPromptOptions: { sections } },
          {
            cwd: tmpdir(),
            getSystemPrompt: () => "Base prompt",
            isProjectTrusted: () => false,
          }
        );

        const prompt = sections.advisor_invocation_settings;
        expect(result.message).toMatchObject({
          content: expect.stringContaining(
            "remaining this session: unlimited."
          ),
          customType: "advisor-budget",
          display: false,
        });
        expect(sections.mcp_servers).toBe("<mcp_servers>servers</mcp_servers>");
        expect(prompt).toStartWith("Advisor invocation settings:");
        expect(prompt).toContain(
          "two consecutive materially equivalent failed attempts"
        );
        expect(prompt).toContain("a deployment changes production data");
        expect(prompt).not.toContain("consequential plan");
        expect(prompt).not.toContain("Before declaring success");
      }
    );
  });

  test("ignores missing system prompt options", async () => {
    await withAgentDir({}, () => {
      let beforeAgentStart: any;
      registerExtension(
        mockPi(
          { activeTools: ["ask_advisor"] },
          {
            on(event: string, handler: any) {
              if (event === "before_agent_start") {
                beforeAgentStart = handler;
              }
            },
            registerTool: () => {},
          }
        )
      );
      const ctx = { cwd: tmpdir(), isProjectTrusted: () => false };

      expect(() => beforeAgentStart({}, ctx)).not.toThrow();
      expect(() =>
        beforeAgentStart({ systemPromptOptions: {} }, ctx)
      ).not.toThrow();
      expect(() =>
        beforeAgentStart({ systemPromptOptions: null }, ctx)
      ).not.toThrow();
    });
  });

  test("removes the invocation rules when ask_advisor is inactive", async () => {
    await withAgentDir({ advisorFailureGate: true }, () => {
      let beforeAgentStart: any;
      registerExtension(
        mockPi(
          { activeTools: [] },
          {
            on(event: string, handler: any) {
              if (event === "before_agent_start") {
                beforeAgentStart = handler;
              }
            },
            registerTool: () => {},
          }
        )
      );

      const sections: PromptSections = {
        advisor_invocation_settings: "stale",
        mcp_servers: "servers",
      };

      beforeAgentStart(
        { systemPromptOptions: { sections } },
        { cwd: tmpdir(), isProjectTrusted: () => false }
      );
      expect(sections).toEqual({ mcp_servers: "servers" });
    });
  });
});
