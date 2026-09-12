import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAdvisorSettings,
  loadConfig,
  resetConfigCache,
} from "../src/config.ts";
import { clampGitContextLevel, type GitContextLevel } from "../src/git.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { modalHarness, modalTheme } from "./helpers/harness.ts";

describe("Manual Advisor TUI modal", () => {
  test("opens the centered overlay, edits its prefill, and forwards the selected Git level", async () => {
    await withAgentDir(
      { advisorGitContext: "full", advisorHerdrIntegration: false },
      async (agentDir) => {
        const state = new AdvisorSessionState();
        const calls: Array<{
          gitContext: GitContextLevel | undefined;
          question: string | undefined;
        }> = [];
        const harness = modalHarness(
          agentDir,
          state,
          (dialog) => {
            expect(dialog.render(100).join("\n")).toContain("Check");
            dialog.handleInput(" ");
            for (const character of "migration") {
              dialog.handleInput(character);
            }
            dialog.handleInput(String.fromCharCode(13));
          },
          (_ctx, question, _signal, _onChunk, _onScout, gitContext) => {
            calls.push({ gitContext, question });
            return Promise.resolve({
              markdown: "Review complete.",
              thinkingText: "",
            });
          }
        );

        await harness.commands
          .get("advisor-manual")
          .handler("Check", harness.ctx);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(harness.modalOptions).toHaveLength(1);
        expect(harness.modalOptions[0]).toMatchObject({
          overlay: true,
          overlayOptions: { anchor: "center" },
        });
        expect(calls).toEqual([
          { gitContext: "full", question: "Check migration" },
        ]);
        expect(state.consumedCalls).toBe(1);
        expect(harness.entries).toHaveLength(1);
        expect(harness.entries[0]?.type).toBe("advisor-manual-call");
        expect(harness.entries[0]?.data).toMatchObject({
          progressId: expect.any(String),
          question: "Check migration",
        });
        expect(harness.sent[0]?.message).toMatchObject({
          customType: "advisor-manual-result",
          details: { question: "Check migration" },
        });
      }
    );
  });

  test("renders the manual call and loading spinner before completion", async () => {
    await withAgentDir(
      { advisorGitContext: "summary", advisorHerdrIntegration: false },
      async (agentDir) => {
        const state = new AdvisorSessionState();
        let resolveConsult!: (result: {
          markdown: string;
          thinkingText: string;
        }) => void;
        const pending = new Promise<{
          markdown: string;
          thinkingText: string;
        }>((resolve) => {
          resolveConsult = resolve;
        });
        let onChunk: ((thinking: string, text: string) => void) | undefined;
        let onScout: ((event: any) => void) | undefined;
        const harness = modalHarness(
          agentDir,
          state,
          (dialog) => dialog.handleInput(String.fromCharCode(13)),
          (_ctx, _question, _signal, chunk, scout) => {
            onChunk = chunk;
            onScout = scout;
            return pending;
          }
        );

        await harness.commands.get("advisor-manual").handler("", harness.ctx);

        const [entry] = harness.entries;
        const renderer = harness.entryRenderers.get("advisor-manual-call");
        expect(entry).toBeDefined();
        expect(renderer).toBeDefined();
        const component = renderer(entry, { expanded: false }, modalTheme);
        const rendered = component.render(100).join("\n");
        expect(rendered).toContain("Executor → Advisor");
        expect(rendered).toContain("◆ ADVISOR");
        expect(rendered).toContain("Preparing");

        onScout?.({ model: "provider/executor", type: "call" });
        const scoutRendered = component.render(100).join("\n");
        expect(scoutRendered).toContain("◆ SCOUT");
        expect(scoutRendered).toContain("CURATING");
        onScout?.({
          outcome: {
            conversation: "selected evidence",
            metrics: {
              availableCount: 1,
              inputBytes: 1,
              latencyMs: 1,
              omittedBeforeScout: 0,
              selectedCount: 1,
            },
            model: "provider/executor",
            ok: true,
            selectedLabels: [],
            selection: { selectedIds: [], synthesis: "" },
          },
          type: "success",
        });
        onChunk?.("**Thinking**\n\n- check", "Partial answer");
        const advisorRendered = component.render(100).join("\n");
        expect(advisorRendered).toContain("◆ ADVISOR");
        expect(advisorRendered).toContain("Partial answer");
        expect(advisorRendered).toContain("Thinking");
        expect(advisorRendered).not.toContain("**Thinking**");

        harness.events.get("session_shutdown")?.(undefined, harness.ctx);
        resolveConsult({ markdown: "Done.", thinkingText: "" });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    );
  });

  test("submits a blank general review and maps the None choice to off", async () => {
    await withAgentDir(
      { advisorGitContext: "full", advisorHerdrIntegration: false },
      async (agentDir) => {
        const state = new AdvisorSessionState();
        let received:
          | {
              gitContext: GitContextLevel | undefined;
              question: string | undefined;
            }
          | undefined;
        const harness = modalHarness(
          agentDir,
          state,
          (dialog) => {
            dialog.handleInput(String.fromCharCode(9));
            dialog.handleInput(`${String.fromCharCode(27)}[B`);
            dialog.handleInput(`${String.fromCharCode(27)}[B`);
            dialog.handleInput(String.fromCharCode(9));
            dialog.handleInput(String.fromCharCode(13));
          },
          (_ctx, question, _signal, _onChunk, _onScout, gitContext) => {
            received = { gitContext, question };
            return Promise.resolve({
              markdown: "General review.",
              thinkingText: "",
            });
          }
        );

        await harness.commands.get("advisor-manual").handler("", harness.ctx);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(received).toEqual({ gitContext: "off", question: undefined });
        expect(harness.entries).toHaveLength(1);
        expect(harness.entries[0]?.data).toMatchObject({
          progressId: expect.any(String),
          question: undefined,
        });
      }
    );
  });

  test("cancels without consultation, budget use, transcript, or status side effects", async () => {
    await withAgentDir(
      { advisorGitContext: "summary", advisorHerdrIntegration: false },
      async (agentDir) => {
        const state = new AdvisorSessionState();
        let consultations = 0;
        const harness = modalHarness(
          agentDir,
          state,
          (dialog) => dialog.handleInput(String.fromCharCode(27)),
          () => {
            consultations += 1;
            return Promise.resolve({
              markdown: "Should not run.",
              thinkingText: "",
            });
          }
        );

        await harness.commands
          .get("advisor-manual")
          .handler("Check", harness.ctx);

        expect(consultations).toBe(0);
        expect(state.consumedCalls).toBe(0);
        expect(harness.entries).toEqual([]);
        expect(harness.sent).toEqual([]);
        expect(harness.statuses).toEqual([]);
        expect(harness.notices).toEqual([]);
      }
    );
  });

  test("rechecks the budget at Submit and leaves an active older consultation untouched on cancel", async () => {
    await withAgentDir(
      { advisorGitContext: "full", advisorHerdrIntegration: false },
      async (agentDir) => {
        const state = new AdvisorSessionState();
        const signals: AbortSignal[] = [];
        let modalCalls = 0;
        const harness = modalHarness(
          agentDir,
          state,
          (dialog) => {
            modalCalls += 1;
            if (modalCalls === 1) {
              dialog.handleInput(String.fromCharCode(13));
            } else {
              dialog.handleInput(String.fromCharCode(27));
            }
          },
          (_ctx, _question, signal) => {
            if (!signal) {
              throw new Error("Missing manual consultation signal.");
            }
            signals.push(signal);
            return new Promise(() => undefined);
          }
        );

        await harness.commands
          .get("advisor-manual")
          .handler("First", harness.ctx);
        const statusCountAfterFirst = harness.statuses.length;
        await harness.commands
          .get("advisor-manual")
          .handler("Second", harness.ctx);

        expect(signals).toHaveLength(1);
        expect(signals[0]?.aborted).toBe(false);
        expect(state.consumedCalls).toBe(1);
        expect(harness.entries).toHaveLength(1);
        expect(harness.statuses).toHaveLength(statusCountAfterFirst);

        harness.events.get("session_shutdown")?.(
          { reason: "reload" },
          harness.ctx
        );
      }
    );
  });

  test("rejects a Submit after the budget is consumed while the overlay is open", async () => {
    await withAgentDir(
      {
        advisorGitContext: "summary",
        advisorHerdrIntegration: false,
        advisorMaxCallsPerSession: 1,
      },
      async (agentDir) => {
        const state = new AdvisorSessionState();
        let consultations = 0;
        const harness = modalHarness(
          agentDir,
          state,
          (dialog) => {
            state.consumeCall();
            dialog.handleInput(String.fromCharCode(13));
          },
          () => {
            consultations += 1;
            return Promise.resolve({
              markdown: "Should not run.",
              thinkingText: "",
            });
          }
        );

        await harness.commands
          .get("advisor-manual")
          .handler("Check", harness.ctx);

        expect(consultations).toBe(0);
        expect(state.consumedCalls).toBe(1);
        expect(harness.entries).toEqual([]);
        expect(harness.sent).toEqual([]);
        expect(harness.statuses).toEqual([]);
        expect(harness.notices).toEqual([
          "Advisor call budget exhausted for this session.",
        ]);
      }
    );
  });

  test("aborts an older consultation only after a newer modal submission", async () => {
    await withAgentDir(
      { advisorGitContext: "full", advisorHerdrIntegration: false },
      async (agentDir) => {
        const state = new AdvisorSessionState();
        const signals: AbortSignal[] = [];
        const harness = modalHarness(
          agentDir,
          state,
          (dialog) => {
            dialog.handleInput(String.fromCharCode(13));
          },
          (_ctx, _question, signal) => {
            if (!signal) {
              throw new Error("Missing manual consultation signal.");
            }
            signals.push(signal);
            return new Promise(() => undefined);
          }
        );

        await harness.commands
          .get("advisor-manual")
          .handler("First", harness.ctx);
        await harness.commands
          .get("advisor-manual")
          .handler("Second", harness.ctx);

        expect(signals).toHaveLength(2);
        expect(signals[0]?.aborted).toBe(true);
        expect(signals[1]?.aborted).toBe(false);
        expect(state.consumedCalls).toBe(2);

        harness.events.get("session_shutdown")?.(
          { reason: "reload" },
          harness.ctx
        );
      }
    );
  });

  test("keeps the backend clamp effective when the modal selection becomes stale", async () => {
    await withAgentDir(
      { advisorGitContext: "full", advisorHerdrIntegration: false },
      async (agentDir) => {
        const state = new AdvisorSessionState();
        let requested: GitContextLevel | undefined;
        let effective: GitContextLevel | undefined;
        const harness = modalHarness(
          agentDir,
          state,
          (dialog) => {
            writeFileSync(
              join(agentDir, "advisor.json"),
              JSON.stringify({
                advisorGitContext: "summary",
                advisorHerdrIntegration: false,
              })
            );
            resetConfigCache();
            dialog.handleInput(String.fromCharCode(13));
          },
          (ctx, _question, _signal, _onChunk, _onScout, gitContext) => {
            loadConfig(ctx);
            const allowed = getAdvisorSettings().gitContext;
            requested = gitContext;
            effective = clampGitContextLevel(gitContext ?? allowed, allowed);
            return Promise.resolve({
              markdown: "Clamped review.",
              thinkingText: "",
            });
          }
        );

        await harness.commands
          .get("advisor-manual")
          .handler("Check", harness.ctx);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(requested).toBe("full");
        expect(effective).toBe("summary");
      }
    );
  });

  test("keeps RPC invocation immediate and does not call the TUI overlay", async () => {
    await withAgentDir(
      { advisorGitContext: "summary", advisorHerdrIntegration: false },
      async (agentDir) => {
        const state = new AdvisorSessionState();
        let receivedQuestion: string | undefined;
        const harness = modalHarness(
          agentDir,
          state,
          () => {
            throw new Error("RPC must not open the TUI overlay.");
          },
          (_ctx, question, _signal, _onChunk, _onScout, gitContext) => {
            receivedQuestion = question;
            expect(gitContext).toBeUndefined();
            return Promise.resolve({
              markdown: "RPC review.",
              thinkingText: "",
            });
          },
          "rpc"
        );

        await harness.commands
          .get("advisor-manual")
          .handler("RPC focus", harness.ctx);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(harness.modalOptions).toEqual([]);
        expect(receivedQuestion).toBe("RPC focus");
        expect(state.consumedCalls).toBe(1);
      }
    );
  });
});
