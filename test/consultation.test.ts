import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import {
  fauxAssistantMessage,
  registerFauxProvider,
} from "@earendil-works/pi-ai/compat";
import registerExtension, {
  consultAdvisor,
  runAdvisorGate,
} from "../extensions/index.ts";
import {
  setAdvisorRedactSecretsRef,
  setAdvisorToolPoliciesRef,
} from "../src/config.ts";
import { advisorRequestConversation } from "../src/tools.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { mockPi } from "./helpers/mock-pi.ts";

const fauxContext = (agentDir: string, faux: any) =>
  ({
    cwd: agentDir,
    isProjectTrusted: () => false,
    modelRegistry: {
      find: () => faux.models[0],
      getApiKeyAndHeaders: () => Promise.resolve({ apiKey: "key", ok: true }),
    },
    sessionManager: { getBranch: () => [] },
  }) as any;

describe("Advisor consultation request construction", () => {
  test("applies redaction at the Advisor request-context boundary", () => {
    const secret = "AKIAABCDEFGHIJKLMNOP";
    const ctx = {
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
    } as any;
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
              registerTool: () => undefined,
            }
          )
        );
        const result = beforeAgentStart(
          {},
          {
            cwd: tmpdir(),
            getSystemPrompt: () => "Base prompt",
            isProjectTrusted: () => false,
          }
        );
        expect(result.systemPrompt).toContain(
          "two consecutive materially equivalent failed attempts"
        );
        expect(result.systemPrompt).toContain(
          "a deployment changes production data"
        );
        expect(result.systemPrompt).not.toContain("consequential plan");
        expect(result.systemPrompt).not.toContain("Before declaring success");
      }
    );
  });
});
