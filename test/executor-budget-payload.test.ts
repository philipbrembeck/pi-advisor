import { describe, expect, test } from "bun:test";

import type { Model } from "@earendil-works/pi-ai";
import { stream as completions } from "@earendil-works/pi-ai/api/openai-completions";
import { stream as responses } from "@earendil-works/pi-ai/api/openai-responses";
import type { OpenAIResponsesOptions } from "@earendil-works/pi-ai/api/openai-responses";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import type { BeforeAgentStartEvent } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { isRecord } from "../src/content-utils.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { registerAdvisorTool } from "../src/tools.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { mockPi } from "./helpers/mock-pi.ts";

type Messages = Parameters<typeof convertToLlm>[0];

type PromptSections = BeforeAgentStartEvent["systemPromptOptions"]["sections"];

const projectPayload = async (
  messages: Messages,
  api: "openai-responses" | "openai-completions",
  midConversationSupport: false | undefined
) => {
  let payload: any;
  let networkRequests = 0;
  const sentinel = "Captured budget projection before network";

  const model: Model<"openai-responses"> = {
    api: "openai-responses",
    baseUrl: "http://127.0.0.1:1/v1",
    compat:
      midConversationSupport === false
        ? { supportsMidConvoSystemMessages: false }
        : {},
    contextWindow: 32_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "budget-projection-test",
    input: ["text"],
    maxTokens: 64,
    name: "Budget projection test",
    provider: "openai",
    reasoning: false,
  };

  const options = {
    apiKey: "test-key",
    fetch: Object.assign(
      async () => {
        networkRequests += 1;
        throw new Error("Budget projection must never send a request");
      },
      { preconnect: fetch.preconnect }
    ),
    maxRetries: 0,
    onPayload(body) {
      if (!isRecord(body)) {
        throw new Error("Expected a provider payload object");
      }

      payload = structuredClone(body);
      throw new Error(sentinel);
    },
    sessionId: "stable-budget-session",
  } satisfies OpenAIResponsesOptions;

  const context = normalizeContext({ messages: convertToLlm(messages) });

  const stream =
    api === "openai-responses"
      ? responses(model, context, options)
      : completions({ ...model, api: "openai-completions" }, context, options);

  const result = await stream.result();
  expect(payload).toBeDefined();
  expect(result.stopReason).toBe("error");
  expect(result.errorMessage).toContain(sentinel);
  expect(networkRequests).toBe(0);

  return payload;
};

describe("Executor budget provider projection", () => {
  for (const api of ["openai-responses", "openai-completions"] as const) {
    for (const midConversationSupport of [false, undefined] as const) {
      test(`${api} preserves the complete prefix with mid-conversation support ${midConversationSupport ?? "unset"}`, async () => {
        await withAgentDir({ advisorMaxCallsPerSession: 2 }, async (cwd) => {
          const events = new Map<string, any>();
          const state = new AdvisorSessionState();
          registerAdvisorTool(
            mockPi({ activeTools: ["ask_advisor"], events }),
            state
          );

          const ctx = asExtensionContext({
            cwd,
            hasUI: false,
            isProjectTrusted: () => false,
          });

          const sections: PromptSections = {
            preamble: "Stable executor instructions",
          };

          const first = events.get("before_agent_start")(
            { systemPromptOptions: { sections } },
            ctx
          );

          const initialSections = structuredClone(sections);

          const history: Messages = [
            {
              content: "",
              role: "system",
              sections,
              timestamp: 0,
              toolsAdded: [
                {
                  description:
                    "Synthetic tool declaration for cache-prefix regression",
                  name: "budget_fixture",
                  parameters: Type.Object({ question: Type.String() }),
                },
              ],
            },
            {
              content: "Synthetic conversation data",
              role: "user",
              timestamp: 1,
            },
            { ...first.message, role: "custom", timestamp: 2 },
          ];

          const original = structuredClone(history);

          const previous = await projectPayload(
            history,
            api,
            midConversationSupport
          );

          state.consumeCall();

          const next = events.get("before_agent_start")(
            { systemPromptOptions: { sections } },
            ctx
          );

          expect(sections).toEqual(initialSections);

          const current = await projectPayload(
            [
              ...history,
              {
                content: "A new run after the consultation",
                role: "user",
                timestamp: 3,
              },
              { ...next.message, role: "custom", timestamp: 4 },
            ],
            api,
            midConversationSupport
          );

          const previousItems = previous.input ?? previous.messages;
          const currentItems = current.input ?? current.messages;

          expect(currentItems.slice(0, previousItems.length)).toEqual(
            previousItems
          );
          expect(JSON.stringify(currentItems[0])).not.toContain(
            "remaining this session:"
          );
          expect(JSON.stringify(currentItems.at(-1))).toContain(
            "remaining this session: 1."
          );
          expect(previous.tools).toHaveLength(1);
          expect(current.tools).toEqual(previous.tools);

          if (api === "openai-responses") {
            expect(previous.prompt_cache_key).toBe("stable-budget-session");
          }

          expect(current.prompt_cache_key).toEqual(previous.prompt_cache_key);
          expect(current.model).toEqual(previous.model);
          expect(history).toEqual(original);
        });
      });
    }
  }
});
