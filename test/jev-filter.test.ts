import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  setAdvisorJevFilterEnabledRef,
  setAdvisorJevFilterOverrideWindowRef,
  setSimpleModeRef,
} from "../src/config/state.ts";
import { resetConfigCache } from "../src/config/storage.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import {
  normalizeScreeningQuestion,
  resetJevOutageNotification,
  screenConsultation,
} from "../src/tools/jev-filter.ts";
import { branchFromLines, systemOneMock } from "./helpers/jev-mock.ts";

const credentials = { apiKey: "tsk-test", transport: "typesafe" as const };

const ctxWith = (options: { notifications?: string[] } = {}) =>
  ({
    cwd: "/",
    hasUI: true,
    isProjectTrusted: () => false,
    sessionManager: {
      getBranch: () => branchFromLines([["user", "Fix the bug."]]),
    },
    ui: {
      notify: (message: string) => options.notifications?.push(message),
    },
  }) as unknown as ExtensionContext;

const verdictResponse = (p0: number, noul: number) => ({
  answers: {
    self_answerable: { noul, type: "noul" },
    stakes: {
      confidence: 0.9,
      legend: {
        "0": "Negligible: routine, low-risk, mechanical, or reversible; a wrong call costs little and is easy to undo.",
        "1": "Moderate: some risk or rework, but bounded and recoverable.",
        "2": "High: material consequences for correctness, security, cost, user trust, or irreversibility.",
      },
      probabilities: { "0": p0, "1": 0.2, "2": 0.8 - p0 },
      score: 1,
      type: "score",
    },
  },
  usage: { input_tokens: 900, output_tokens: 0 },
});

beforeEach(() => {
  setAdvisorJevFilterEnabledRef(true);
  resetJevOutageNotification();
});

afterEach(() => {
  setAdvisorJevFilterEnabledRef(false);
  setAdvisorJevFilterOverrideWindowRef(10);
  setSimpleModeRef(false);
  resetConfigCache();
});

describe("screenConsultation", () => {
  test("allows without a Jev call when the filter is disabled or simple mode", async () => {
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

  test("repeat reattachment works with the Jev filter disabled", async () => {
    setAdvisorJevFilterEnabledRef(false);
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
        fetch: (input: string, init?: RequestInit) => {
          calls += 1;
          return systemOneMock([]).fetch(input, init);
        },
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    expect(calls).toBe(0);
    expect(outcome.decision).toBe("skip");
    if (outcome.decision === "skip") {
      expect(outcome.kind).toBe("repeat");
      expect(outcome.reattachedAdvice).toContain("migration plan");
    }
    const summary = session.summary(undefined) ?? "";
    expect(summary).toContain(
      "Consultation dedup: 1 repeat question skipped, earlier advice reattached"
    );
    expect(summary).not.toContain("Jev filter:");
    expect(summary).not.toContain("Jev cost");
  });

  test("allows on confident negligible stakes AND self-answerable only otherwise skips", async () => {
    const session = new AdvisorSessionState();
    const allowMock = systemOneMock([verdictResponse(0.2, 0.9)]);
    const allow = await screenConsultation(
      ctxWith(),
      session,
      { question: "Ship the migration?" },
      {
        fetch: allowMock.fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    expect(allow).toEqual({ decision: "allow" });

    const skipMock = systemOneMock([verdictResponse(0.95, 0.9)]);
    const skip = await screenConsultation(
      ctxWith(),
      session,
      { question: "Which import order?" },
      {
        fetch: skipMock.fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    expect(skip.decision).toBe("skip");
    if (skip.decision === "skip") {
      expect(skip.kind).toBe("screened");
      expect(skip.reason).toContain("low stakes");
    }
  });

  test("records ledger counts and Jev spend on the session", async () => {
    const session = new AdvisorSessionState();
    const mock = systemOneMock([
      verdictResponse(0.95, 0.9),
      verdictResponse(0.2, 0.9),
    ]);
    await screenConsultation(
      ctxWith(),
      session,
      { question: "a?" },
      {
        fetch: mock.fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    await screenConsultation(
      ctxWith(),
      session,
      { question: "b?" },
      {
        fetch: mock.fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    const summary = session.summary(undefined);
    expect(summary).toContain("Jev filter: 2 screened (1 allowed, 1 skipped)");
    expect(summary).toContain("Jev cost: ↑1.8k tokens · $0.0001");
  });

  test("missing credentials allow with one missing-key notification", async () => {
    const notifications: string[] = [];
    const session = new AdvisorSessionState();
    const outcome = await screenConsultation(
      ctxWith({ notifications }),
      session,
      {
        question: "x?",
      },
      {
        resolveTransport: () => Promise.resolve(undefined),
      }
    );
    expect(outcome).toEqual({ decision: "allow" });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("missing-key");
    await screenConsultation(
      ctxWith({ notifications }),
      session,
      {
        question: "y?",
      },
      {
        resolveTransport: () => Promise.resolve(undefined),
      }
    );
    expect(notifications).toHaveLength(1);
    expect(summaryLine(session)).toContain("2 failures");
  });

  test("a 401 allows with a single auth notification and no key material", async () => {
    const notifications: string[] = [];
    const session = new AdvisorSessionState();
    const mock = systemOneMock([{ body: { error: "bad key" }, status: 401 }]);
    const outcome = await screenConsultation(
      ctxWith({ notifications }),
      session,
      { question: "x?" },
      {
        fetch: mock.fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    expect(outcome).toEqual({ decision: "allow" });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("(auth)");
    expect(notifications[0]).not.toContain("tsk-test");
    await screenConsultation(
      ctxWith({ notifications }),
      session,
      { question: "y?" },
      {
        fetch: systemOneMock([{ body: { error: "bad key" }, status: 401 }])
          .fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    expect(notifications).toHaveLength(1);
  });

  test("a malformed response allows with a malformed notification", async () => {
    const notifications: string[] = [];
    const session = new AdvisorSessionState();
    const mock = systemOneMock([{ answers: "garbage" }]);
    const outcome = await screenConsultation(
      ctxWith({ notifications }),
      session,
      { question: "x?" },
      {
        fetch: mock.fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    expect(outcome).toEqual({ decision: "allow" });
    expect(notifications[0]).toContain("(malformed)");
  });

  test("a repeat question skips without a Jev call and reattaches advice", async () => {
    const session = new AdvisorSessionState();
    session.issueAdvice(
      "advice-1",
      "Use the migration plan from earlier.",
      "executor-requested",
      false,
      "which import order?"
    );
    let calls = 0;
    const mock = systemOneMock([
      {
        ...verdictResponse(0, 0),
        __never: () => {
          calls += 1;
        },
      },
    ]);
    const outcome = await screenConsultation(
      ctxWith(),
      session,
      {
        question: "  WHICH   import Order? ",
      },
      {
        fetch: (input: string, init?: RequestInit) => {
          calls += 1;
          return mock.fetch(input, init);
        },
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    expect(calls).toBe(0);
    expect(outcome.decision).toBe("skip");
    if (outcome.decision === "skip") {
      expect(outcome.kind).toBe("repeat");
      expect(outcome.reattachedAdvice).toContain("migration plan");
    }
    expect(summaryLine(session)).toBe("");
    expect(session.summary(undefined) ?? "").toContain(
      "Consultation dedup: 1 repeat question skipped, earlier advice reattached"
    );
  });

  test("force bypasses screening and counts an override after a matching skip", async () => {
    const session = new AdvisorSessionState();
    const skipMock = systemOneMock([verdictResponse(0.95, 0.9)]);
    await screenConsultation(
      ctxWith(),
      session,
      { question: "ship it?" },
      {
        fetch: skipMock.fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    const forced = await screenConsultation(
      ctxWith(),
      session,
      { force: true, question: "ship it?" },
      {
        fetch: systemOneMock([]).fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    expect(forced).toEqual({ decision: "allow" });
    expect(summaryLine(session)).toContain("1 override");
  });

  test("the same question within the override window passes through automatically", async () => {
    const session = new AdvisorSessionState();
    const skipMock = systemOneMock([verdictResponse(0.95, 0.9)]);
    await screenConsultation(
      ctxWith(),
      session,
      { question: "ship it?" },
      {
        fetch: skipMock.fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    session.recordCompletedTurn();
    session.recordCompletedTurn();
    let calls = 0;
    const outcome = await screenConsultation(
      ctxWith(),
      session,
      { question: "ship it?" },
      {
        fetch: (input: string, init?: RequestInit) => {
          calls += 1;
          return systemOneMock([]).fetch(input, init);
        },
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    expect(outcome).toEqual({ decision: "allow" });
    expect(calls).toBe(0);
    expect(summaryLine(session)).toContain("1 override");
  });

  test("the passthrough expires after the configured window", async () => {
    const session = new AdvisorSessionState();
    setAdvisorJevFilterOverrideWindowRef(2);
    const skipMock = systemOneMock([verdictResponse(0.95, 0.9)]);
    await screenConsultation(
      ctxWith(),
      session,
      { question: "ship it?" },
      {
        fetch: skipMock.fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    for (let turn = 0; turn < 3; turn += 1) {
      session.recordCompletedTurn();
    }
    const later = systemOneMock([verdictResponse(0.95, 0.9)]);
    const outcome = await screenConsultation(
      ctxWith(),
      session,
      { question: "ship it?" },
      {
        fetch: later.fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    expect(outcome.decision).toBe("skip");
    expect(later.captured).toHaveLength(1);
  });

  test("empty questions never match repeats or passthroughs", async () => {
    const session = new AdvisorSessionState();
    const first = await screenConsultation(
      ctxWith(),
      session,
      {},
      {
        fetch: systemOneMock([verdictResponse(0.95, 0.9)]).fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    expect(first.decision).toBe("skip");
    const second = await screenConsultation(
      ctxWith(),
      session,
      {},
      {
        fetch: systemOneMock([verdictResponse(0.2, 0.3)]).fetch,
        resolveTransport: () => Promise.resolve(credentials),
      }
    );
    expect(second).toEqual({ decision: "allow" });
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

const summaryLine = (session: AdvisorSessionState) => {
  const summary = session.summary(undefined) ?? "";
  return (
    summary.split("\n").find((line) => line.startsWith("Jev filter:")) ?? ""
  );
};
