import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fauxAssistantMessage,
  registerFauxProvider,
} from "@earendil-works/pi-ai/compat";

import { loadConfig, resetConfigCache } from "../src/config.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { registerAdvisorTool } from "../src/tools.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { mockPi } from "./helpers/mock-pi.ts";

const registerHandoffTool = (
  state: AdvisorSessionState,
  consulted: (string[] | undefined)[]
) => {
  const tools = new Map<string, any>();
  registerAdvisorTool(mockPi({ tools }), state, {
    consult: async (
      _ctx,
      _question,
      _signal,
      _onChunk,
      _trigger,
      _gitContext,
      _draft,
      _untracked,
      includeTracked
    ) => {
      consulted.push(includeTracked);
      return {
        adviceId: "advice-2",
        markdown: "Done.",
        model: "provider/advisor",
        thinkingText: "",
        trigger: "executor-requested" as const,
      };
    },
  });
  return () => tools.get("ask_advisor");
};

const handoffContext = (cwd: string) =>
  asExtensionContext({
    cwd,
    hasUI: false,
    isProjectTrusted: () => false,
  });

describe("Tracked file handoff", () => {
  test("rejects disabled consent without consuming the one-shot handoff", async () => {
    await withAgentDir(
      { advisorTrackedFileContent: false },
      async (agentDir) => {
        const configPath = join(agentDir, "advisor.json");
        const consulted: (string[] | undefined)[] = [];
        const state = new AdvisorSessionState();
        const getTool = registerHandoffTool(state, consulted);
        const ctx = handoffContext(agentDir);
        const handoff = { includeTrackedFiles: ["src/foo.ts"] };
        state.issueAdvice(
          "advice-1",
          "Review src/foo.ts",
          "executor-requested"
        );

        loadConfig(ctx);
        await expect(
          getTool().execute(
            "call-1",
            handoff,
            new AbortController().signal,
            undefined,
            ctx
          )
        ).rejects.toThrow("advisorTrackedFileContent");
        expect(consulted).toHaveLength(0);

        // The same handoff claim still works once consent is enabled.
        writeFileSync(
          configPath,
          JSON.stringify({ advisorTrackedFileContent: true })
        );
        resetConfigCache();
        loadConfig(ctx);
        await getTool().execute(
          "call-2",
          handoff,
          new AbortController().signal,
          undefined,
          ctx
        );
        expect(consulted).toEqual([["src/foo.ts"]]);

        // The successful call consumed the one-shot handoff.
        await expect(
          getTool().execute(
            "call-3",
            handoff,
            new AbortController().signal,
            undefined,
            ctx
          )
        ).rejects.toThrow("Tracked file handoff requires a prior");
        expect(consulted).toHaveLength(1);
      }
    );
  });

  test("a budget-exhausted handoff call keeps the claim for a later retry", async () => {
    await withAgentDir(
      {
        advisorMaxCallsPerSession: 1,
        advisorTrackedFileContent: true,
      },
      async (agentDir) => {
        const configPath = join(agentDir, "advisor.json");
        const consulted: (string[] | undefined)[] = [];
        const state = new AdvisorSessionState();
        const getTool = registerHandoffTool(state, consulted);
        const ctx = handoffContext(agentDir);
        const handoff = { includeTrackedFiles: ["src/foo.ts"] };
        state.issueAdvice(
          "advice-1",
          "Review src/foo.ts",
          "executor-requested"
        );

        loadConfig(ctx);
        state.consumeCall();
        await expect(
          getTool().execute(
            "call-1",
            handoff,
            new AbortController().signal,
            undefined,
            ctx
          )
        ).rejects.toThrow("Advisor call budget exhausted for this session.");
        expect(consulted).toHaveLength(0);

        // Raising the budget lets the preserved claim reach the Advisor.
        writeFileSync(
          configPath,
          JSON.stringify({
            advisorMaxCallsPerSession: 2,
            advisorTrackedFileContent: true,
          })
        );
        resetConfigCache();
        loadConfig(ctx);
        await getTool().execute(
          "call-2",
          handoff,
          new AbortController().signal,
          undefined,
          ctx
        );
        expect(consulted).toEqual([["src/foo.ts"]]);
      }
    );
  });

  test("attaches a claimed tracked file through the real consultation path", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "pi-advisor-handoff-repo-"));
    mkdirSync(join(repoDir, "notes"), { recursive: true });
    execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
    writeFileSync(
      join(repoDir, "notes", "review.md"),
      "tracked body for the advisor"
    );
    execFileSync("git", ["add", "notes/review.md"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    const faux = registerFauxProvider({
      api: "pi-advisor-handoff-test",
      models: [{ id: "advisor", input: ["text"] }],
      provider: "pi-advisor-handoff-test",
    });
    const tools = new Map<string, any>();
    const state = new AdvisorSessionState();
    // The real consultAdvisor runs; only the provider is faked.
    registerAdvisorTool(mockPi({ tools }), state);
    state.issueAdvice(
      "advice-1",
      "Review notes/review.md",
      "executor-requested"
    );
    const captured: string[] = [];

    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-handoff-test/advisor",
          advisorGitContext: "off",
          advisorTrackedFileContent: true,
        },
        async () => {
          faux.setResponses([
            (fauxContext) => {
              captured.push(JSON.stringify(fauxContext.messages));
              return fauxAssistantMessage("Advice after review.");
            },
          ]);
          const ctx = asExtensionContext({
            cwd: repoDir,
            hasUI: false,
            isProjectTrusted: () => false,
            modelRegistry: {
              find: () => faux.models[0],
              getApiKeyAndHeaders: () =>
                Promise.resolve({ apiKey: "key", ok: true }),
            },
            sessionManager: { getBranch: () => [] },
          });
          loadConfig(ctx);
          const result = await tools
            .get("ask_advisor")
            .execute(
              "call-1",
              { includeTrackedFiles: ["notes/review.md"] },
              new AbortController().signal,
              undefined,
              ctx
            );
          expect(result.details.trackedBytes).toBeGreaterThan(0);
          expect(captured).toHaveLength(1);
          expect(captured[0]).toContain("tracked body for the advisor");
        }
      );
    } finally {
      faux.unregister();
      rmSync(repoDir, { force: true, recursive: true });
    }
  });
});
