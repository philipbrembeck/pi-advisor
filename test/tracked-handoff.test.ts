import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fauxAssistantMessage,
  registerFauxProvider,
} from "@earendil-works/pi-ai/compat";

import { getAdvisorConfigSnapshot } from "../src/commands/configuration-tool-policy.ts";
import { advisorConfigRiskNotes } from "../src/commands/configuration-tool-preview.ts";
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

const NAMED_RULE_LINE =
  "- Attach tracked files with `includeTrackedFiles` only after the Advisor names them.";

const EXECUTOR_RULE_LINE =
  "- When your question or draft depends on specific repository documents, attach them with `includeTrackedFiles`. Prefer a few key files within the size limits.";

/** Returns the advisor_invocation_settings section as before_agent_start builds it. */
const invocationSection = (dir: string) => {
  const events = new Map<string, any>();
  registerAdvisorTool(
    mockPi({ activeTools: ["ask_advisor"], events }),
    new AdvisorSessionState()
  );
  const sections: Record<string, string> = {};

  events.get("before_agent_start")(
    { systemPromptOptions: { sections } },
    handoffContext(dir)
  );

  return sections.advisor_invocation_settings ?? "";
};

describe("Tracked file handoff modes", () => {
  test("executor mode attaches a file the Advisor never named, then restores the claim rule", async () => {
    await withAgentDir(
      {
        advisorTrackedFileContent: true,
        advisorTrackedFileHandoff: "executor",
      },
      async (agentDir) => {
        const configPath = join(agentDir, "advisor.json");
        const consulted: (string[] | undefined)[] = [];
        const state = new AdvisorSessionState();
        const getTool = registerHandoffTool(state, consulted);
        const ctx = handoffContext(agentDir);
        const handoff = { includeTrackedFiles: ["src/foo.ts"] };

        loadConfig(ctx);
        await getTool().execute(
          "call-1",
          handoff,
          new AbortController().signal,
          undefined,
          ctx
        );
        await getTool().execute(
          "call-2",
          handoff,
          new AbortController().signal,
          undefined,
          ctx
        );
        expect(consulted).toEqual([["src/foo.ts"], ["src/foo.ts"]]);

        // The last Advisor answer ("Done.") does not name the file, so the
        // Advisor-named rule rejects the call once the mode is switched back.
        writeFileSync(
          configPath,
          JSON.stringify({
            advisorTrackedFileContent: true,
            advisorTrackedFileHandoff: "advisor-named",
          })
        );
        resetConfigCache();
        loadConfig(ctx);
        await expect(
          getTool().execute(
            "call-3",
            handoff,
            new AbortController().signal,
            undefined,
            ctx
          )
        ).rejects.toThrow("Tracked file handoff requires a prior");
        expect(consulted).toHaveLength(2);
      }
    );
  });

  test("executor mode still requires tracked file content consent", async () => {
    await withAgentDir(
      {
        advisorTrackedFileContent: false,
        advisorTrackedFileHandoff: "executor",
      },
      async (agentDir) => {
        const consulted: (string[] | undefined)[] = [];

        const state = new AdvisorSessionState();
        const getTool = registerHandoffTool(state, consulted);
        const ctx = handoffContext(agentDir);

        loadConfig(ctx);
        await expect(
          getTool().execute(
            "call-1",
            { includeTrackedFiles: ["src/foo.ts"] },
            new AbortController().signal,
            undefined,
            ctx
          )
        ).rejects.toThrow("advisorTrackedFileContent");
        expect(consulted).toHaveLength(0);
      }
    );
  });

  test("advisor-named mode rejects a path the Advisor did not name", async () => {
    await withAgentDir(
      {
        advisorTrackedFileContent: true,
        advisorTrackedFileHandoff: "advisor-named",
      },
      async (agentDir) => {
        const consulted: (string[] | undefined)[] = [];
        const state = new AdvisorSessionState();
        const getTool = registerHandoffTool(state, consulted);
        const ctx = handoffContext(agentDir);
        const handoff = { includeTrackedFiles: ["src/foo.ts"] };

        loadConfig(ctx);
        await expect(
          getTool().execute(
            "call-1",
            handoff,
            new AbortController().signal,
            undefined,
            ctx
          )
        ).rejects.toThrow("Tracked file handoff requires a prior");
        expect(consulted).toHaveLength(0);

        state.issueAdvice(
          "advice-1",
          "Review src/foo.ts",
          "executor-requested"
        );
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
});

describe("Tracked file handoff guidance", () => {
  test("advisor-named mode adds the named-file rule when consent is on", async () => {
    await withAgentDir({ advisorTrackedFileContent: true }, (dir) => {
      expect(invocationSection(dir).split("\n")).toContain(NAMED_RULE_LINE);
    });
  });

  test("executor mode adds the attach rule when consent is on", async () => {
    await withAgentDir(
      {
        advisorTrackedFileContent: true,
        advisorTrackedFileHandoff: "executor",
      },
      (dir) => {
        expect(invocationSection(dir).split("\n")).toContain(
          EXECUTOR_RULE_LINE
        );
      }
    );
  });

  test("adds no tracked-file rule in either mode while consent is off", async () => {
    for (const handoff of ["advisor-named", "executor"] as const) {
      await withAgentDir(
        {
          advisorTrackedFileContent: false,
          advisorTrackedFileHandoff: handoff,
        },
        (dir) => {
          expect(invocationSection(dir)).not.toContain("includeTrackedFiles");
        }
      );
    }
  });

  test("adds only the mode rule in both simple and full modes", async () => {
    for (const simpleMode of [false, true]) {
      let withoutConsent = "";
      let withConsent = "";

      await withAgentDir(
        { advisorTrackedFileContent: false, simpleMode },
        (dir) => {
          withoutConsent = invocationSection(dir);
        }
      );
      await withAgentDir(
        { advisorTrackedFileContent: true, simpleMode },
        (dir) => {
          withConsent = invocationSection(dir);
        }
      );

      expect(withConsent.split("\n")).toContain(NAMED_RULE_LINE);
      expect(
        withConsent.split("\n").filter((line) => line !== NAMED_RULE_LINE)
      ).toEqual(withoutConsent.split("\n"));
    }
  });

  test("omits the empty-object default line when only the mode rule remains", async () => {
    await withAgentDir(
      {
        advisorCompletionGate: false,
        advisorFailureGate: false,
        advisorPlanGate: false,
        advisorTrackedFileContent: true,
        advisorTrackedFileHandoff: "executor",
      },
      (dir) => {
        expect(invocationSection(dir)).toBe(
          [
            "Advisor invocation settings:",
            EXECUTOR_RULE_LINE,
            "- Reserve Advisor calls for material decisions, repeated failures, or final review.",
          ].join("\n")
        );
      }
    );
  });

  test("keeps static ask_advisor texts neutral and still states consent and untrusted data", () => {
    const tools = new Map<string, any>();
    registerAdvisorTool(mockPi({ tools }), new AdvisorSessionState());
    const tool = tools.get("ask_advisor");

    const texts = [
      tool.description,
      ...tool.promptGuidelines,
      tool.parameters.properties.includeTrackedFiles.items.description,
    ].join("\n");

    expect(texts).not.toMatch(/explicitly (?:names|says)/u);
    expect(texts).toContain("advisorTrackedFileContent");
    expect(texts).toContain("untrusted");
  });

  test("the configuration preview warns before enabling executor handoff", () => {
    const notes = advisorConfigRiskNotes(
      { advisorTrackedFileHandoff: "executor" },
      getAdvisorConfigSnapshot(),
      {}
    );

    expect(notes.join("\n")).toContain(
      "without waiting for the Advisor to name them"
    );
  });
});
