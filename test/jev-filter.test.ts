import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  setAdvisorJevClassifierRef,
  setAdvisorJevFilterEnabledRef,
  setAdvisorJevFilterOverrideWindowRef,
  setSimpleModeRef,
} from "../src/config/state.ts";
import { resetConfigCache } from "../src/config/storage.ts";
import type { JevClassifierResult } from "../src/jev/classifier.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import {
  normalizeScreeningQuestion,
  resetJevOutageNotification,
  screenConsultation,
} from "../src/tools/jev-filter.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { branchFromLines } from "./helpers/jev-mock.ts";

const ctxWith = (notifications: string[] = []) =>
  asExtensionContext({
    cwd: "/",
    hasUI: true,
    isProjectTrusted: () => false,
    sessionManager: {
      getBranch: () => branchFromLines([["user", "Fix the bug."]]),
    },
    ui: { notify: (message: string) => notifications.push(message) },
  });

const result = (
  probability: number,
  stakes: number,
  cost = 0.00002
): JevClassifierResult => ({
  answers: {
    self_answerable: { noul: probability, type: "noul" },
    stakes: {
      choice: "negligible",
      confidence: stakes,
      probabilities: { high: 1 - stakes, moderate: 0, negligible: stakes },
      type: "choice",
    },
  },
  model: "typesafe/jev-latest",
  usage: { cost, inputTokens: 10, outputTokens: 2 },
});

const classifier = (answer: JevClassifierResult) => async () => answer;

beforeEach(() => {
  setAdvisorJevFilterEnabledRef(true);
  setAdvisorJevClassifierRef("typesafe/jev-latest");
  resetJevOutageNotification();
});

afterEach(() => {
  setAdvisorJevFilterEnabledRef(false);
  setAdvisorJevClassifierRef(undefined);
  setAdvisorJevFilterOverrideWindowRef(10);
  setSimpleModeRef(false);
  resetConfigCache();
});

describe("screenConsultation", () => {
  test("disabled filter and simple mode bypass classification", async () => {
    setAdvisorJevFilterEnabledRef(false);
    const session = new AdvisorSessionState();
    expect(await screenConsultation(ctxWith(), session, {})).toEqual({
      decision: "allow",
    });
    setAdvisorJevFilterEnabledRef(true);
    setSimpleModeRef(true);
    expect(await screenConsultation(ctxWith(), session, {})).toEqual({
      decision: "allow",
    });
    expect(session.summary(undefined)).toBeUndefined();
  });

  test("repeat questions reattach prior advice without classifying", async () => {
    const session = new AdvisorSessionState();
    session.issueAdvice(
      "advice-1",
      "Use the migration plan from earlier.",
      "executor-requested",
      false,
      "ship it?"
    );
    let calls = 0;

    const outcome = await screenConsultation(
      ctxWith(),
      session,
      { question: "Ship it?" },
      {
        classify: async () => {
          calls += 1;

          return result(0.9, 0.99);
        },
      }
    );

    expect(outcome.decision).toBe("skip");

    if (outcome.decision === "skip") {
      expect(outcome.kind).toBe("repeat");
      expect(outcome.reattachedAdvice).toContain("migration plan");
    }

    expect(calls).toBe(0);
  });

  test("screens only on confident negligible stakes AND self-answerability", async () => {
    const session = new AdvisorSessionState();

    const allow = await screenConsultation(
      ctxWith(),
      session,
      { question: "Ship the migration?" },
      {
        classifyResult: classifier(result(0.9, 0.2)),
      }
    );

    expect(allow.decision).toBe("allow");

    const skip = await screenConsultation(
      ctxWith(),
      session,
      { question: "Which import order?" },
      {
        classifyResult: classifier(result(0.9, 0.95)),
      }
    );

    expect(skip.decision).toBe("skip");
  });

  test("records catalog-priced usage and exposes it with the screening result", async () => {
    const session = new AdvisorSessionState();

    const outcome = await screenConsultation(
      ctxWith(),
      session,
      {},
      {
        classifyResult: async () => ({
          ...result(0.9, 0.95),
          usage: {
            cost: 0.00002,
            inputTokens: 10,
            outputTokens: 2,
            piUsage: {
              cacheRead: 0,
              cacheWrite: 0,
              cost: {
                cacheRead: 0,
                cacheWrite: 0,
                input: 0.00002,
                output: 0,
                total: 0.00002,
              },
              input: 10,
              output: 2,
              totalTokens: 12,
            },
          },
        }),
      }
    );

    expect(outcome.decision).toBe("skip");
    expect(outcome.usage?.cost.total).toBe(0.00002);
    expect(session.summary(undefined)).toContain("$0.0000");
  });

  test("missing selection fails open with visible notification", async () => {
    setAdvisorJevClassifierRef(undefined);
    const notifications: string[] = [];
    const session = new AdvisorSessionState();

    const outcome = await screenConsultation(
      ctxWith(notifications),
      session,
      {}
    );

    expect(outcome.decision).toBe("allow");
    expect(notifications[0]).toContain("missing-key");
  });

  test("classifier failures fail open and caller cancellation propagates", async () => {
    const session = new AdvisorSessionState();
    const notifications: string[] = [];

    const outage = await screenConsultation(
      ctxWith(notifications),
      session,
      {},
      {
        classifyResult: async () => {
          throw new Error("provider down");
        },
      }
    );

    expect(outage.decision).toBe("allow");
    expect(notifications[0]).toContain("provider down");

    const controller = new AbortController();

    const pending = screenConsultation(
      ctxWith(),
      new AdvisorSessionState(),
      { signal: controller.signal },
      {
        classifyResult: async () => {
          controller.abort();
          throw new Error("cancelled");
        },
      }
    );

    await expect(pending).rejects.toThrow("cancelled");
  });

  test("force and repeat-window overrides bypass the classifier", async () => {
    const session = new AdvisorSessionState();
    await screenConsultation(
      ctxWith(),
      session,
      { question: "ship it?" },
      {
        classifyResult: classifier(result(0.9, 0.95)),
      }
    );

    const forced = await screenConsultation(ctxWith(), session, {
      force: true,
      question: "ship it?",
    });

    expect(forced.decision).toBe("allow");
    expect(session.summary(undefined)).toContain("1 override");
  });
});

describe("normalizeScreeningQuestion", () => {
  test("folds whitespace and case deterministically", () => {
    expect(normalizeScreeningQuestion("  WHICH   import\nOrder? ")).toBe(
      "which import order?"
    );
    expect(normalizeScreeningQuestion("   ")).toBeUndefined();
  });
});
