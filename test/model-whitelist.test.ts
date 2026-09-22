import { afterEach, describe, expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  setAdvisorJevTurnGateEveryTurnsRef,
  setAdvisorModelWhitelistRef,
} from "../src/config/state.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { registerAdvisorTool } from "../src/tools.ts";
import { consultAdvisor } from "../src/tools/consultation.ts";
import type { JevTurnGateRegistration } from "../src/tools/jev-turn-gate.ts";
import { handleJevTurnEnd } from "../src/tools/jev-turn-gate.ts";
import {
  advisorModelAccess,
  advisorModelAccessReason,
} from "../src/tools/model-access.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { mockPi } from "./helpers/mock-pi.ts";

const contextFor = (
  model: { id: string; provider: string } | undefined
): ExtensionContext => asExtensionContext({ hasUI: false, model });

afterEach(() => {
  setAdvisorJevTurnGateEveryTurnsRef(0);
  setAdvisorModelWhitelistRef([]);
});

describe("Advisor model whitelist", () => {
  test("allows every model when the whitelist is empty", () => {
    setAdvisorModelWhitelistRef([]);
    expect(
      advisorModelAccess(contextFor({ id: "executor", provider: "provider" }))
    ).toEqual({ allowed: true, modelRef: "provider/executor" });
  });

  test("matches the current provider/model reference exactly", () => {
    setAdvisorModelWhitelistRef(["provider/allowed"]);
    const allowed = contextFor({ id: "allowed", provider: "provider" });
    const denied = contextFor({ id: "other", provider: "provider" });

    expect(advisorModelAccess(allowed)).toEqual({
      allowed: true,
      modelRef: "provider/allowed",
    });
    expect(advisorModelAccess(denied).allowed).toBe(false);
    expect(advisorModelAccessReason(denied)).toContain("provider/other");
  });

  test("fails closed when a whitelist is configured without a current model", () => {
    setAdvisorModelWhitelistRef(["provider/allowed"]);
    expect(advisorModelAccess(contextFor(undefined))).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("no current model"),
    });
  });

  test("blocks manual and automatic calls from a non-whitelisted model", async () => {
    await withAgentDir(
      {
        advisorLoopThreshold: 2,
        advisorModelWhitelist: ["provider/allowed"],
      },
      async (agentDir) => {
        const events = new Map<string, any>();
        const tools = new Map<string, any>();
        const session = new AdvisorSessionState();
        let gateCalls = 0;
        registerAdvisorTool(
          mockPi(
            { activeTools: ["ask_advisor"], events, tools },
            { registerTool: (tool: any) => tools.set(tool.name, tool) }
          ),
          session,
          {
            runGate: async () => {
              gateCalls += 1;
              return {
                decision: "proceed",
                markdown: "Decision: proceed",
                model: "provider/advisor",
                ok: true as const,
                thinkingText: "",
                trigger: "repeated-tool-call" as const,
              };
            },
          }
        );
        const ctx = asExtensionContext({
          cwd: agentDir,
          hasUI: false,
          isProjectTrusted: () => false,
          model: { id: "other", provider: "provider" },
          signal: new AbortController().signal,
        });
        const toolCall = events.get("tool_call");

        expect(
          await toolCall(
            {
              input: {},
              toolCallId: "manual",
              toolName: "ask_advisor",
            },
            ctx
          )
        ).toMatchObject({ block: true });
        await toolCall(
          { input: { path: "same" }, toolCallId: "one", toolName: "read" },
          ctx
        );
        await toolCall(
          { input: { path: "same" }, toolCallId: "two", toolName: "read" },
          ctx
        );
        expect(gateCalls).toBe(0);
        expect(session.consumedCalls).toBe(0);

        await expect(
          tools
            .get("ask_advisor")
            .execute("direct", {}, ctx.signal, undefined, ctx)
        ).rejects.toThrow("provider/other");
        await expect(
          consultAdvisor(ctx, "question", ctx.signal)
        ).rejects.toThrow("provider/other");
      }
    );
  });

  test("suppresses the proactive turn gate for a non-whitelisted model", async () => {
    setAdvisorJevTurnGateEveryTurnsRef(1);
    setAdvisorModelWhitelistRef(["provider/allowed"]);
    const session = new AdvisorSessionState();
    let jevChecks = 0;
    let consultations = 0;
    const registration: JevTurnGateRegistration = {
      activeTools: () => ["ask_advisor"],
      consult: async () => {
        consultations += 1;
        return {
          adviceId: "unused",
          markdown: "",
          model: "unused",
          thinkingText: "",
          trigger: "executor-requested",
        };
      },
      deps: {
        resolveTransport: () => {
          jevChecks += 1;
          return Promise.resolve({
            apiKey: "test",
            transport: "typesafe" as const,
          });
        },
      },
      send: () => {},
      session,
    };
    const ctx = contextFor({ id: "other", provider: "provider" });

    await handleJevTurnEnd(registration, ctx);

    expect(jevChecks).toBe(0);
    expect(consultations).toBe(0);
    expect(session.consumedCalls).toBe(0);
  });

  test("allows the automatic gate for a whitelisted model", async () => {
    await withAgentDir(
      {
        advisorLoopThreshold: 2,
        advisorModelWhitelist: ["provider/allowed"],
      },
      async (agentDir) => {
        const events = new Map<string, any>();
        const session = new AdvisorSessionState();
        let gateCalls = 0;
        registerAdvisorTool(
          mockPi(
            { activeTools: ["ask_advisor"], events },
            { registerTool: () => {} }
          ),
          session,
          {
            runGate: async () => {
              gateCalls += 1;
              return {
                decision: "proceed",
                markdown: "Decision: proceed",
                model: "provider/advisor",
                ok: true as const,
                thinkingText: "",
                trigger: "repeated-tool-call" as const,
              };
            },
          }
        );
        const ctx = asExtensionContext({
          cwd: agentDir,
          hasUI: false,
          isProjectTrusted: () => false,
          model: { id: "allowed", provider: "provider" },
          signal: new AbortController().signal,
        });
        const toolCall = events.get("tool_call");

        await toolCall(
          { input: { path: "same" }, toolCallId: "one", toolName: "read" },
          ctx
        );
        await toolCall(
          { input: { path: "same" }, toolCallId: "two", toolName: "read" },
          ctx
        );
        expect(gateCalls).toBe(1);
        expect(session.consumedCalls).toBe(1);
      }
    );
  });
});
