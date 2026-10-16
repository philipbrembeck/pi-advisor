import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  setAdvisorJevClassifierRef,
  setAdvisorJevTurnGateEveryTurnsRef,
  setAdvisorJevTurnGateNoulThresholdRef,
  setAdvisorMaxCallsPerSessionRef,
  setSimpleModeRef,
} from "../src/config/state.ts";
import { resetConfigCache } from "../src/config/storage.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import type { JevTurnGateRegistration } from "../src/tools/jev-turn-gate.ts";
import {
  handleJevTurnEnd,
  resetJevTurnGateNotification,
} from "../src/tools/jev-turn-gate.ts";
import type { AdvisorConsultationResult } from "../src/tools/types.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { branchFromLines } from "./helpers/jev-mock.ts";

const answers = (probability: number) => ({
  answers: { should_consult: { noul: probability, type: "noul" as const } },
  model: "typesafe/jev-latest",
  usage: { cost: 0.00002, inputTokens: 800, outputTokens: 0 },
});

const deferred = <Value>() => {
  let resolvePromise: ((value: Value) => void) | undefined;

  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: (value: Value) => resolvePromise?.(value) };
};

const idleSignal = () => new AbortController().signal;

interface Harness {
  consultCount: () => number;
  registration: JevTurnGateRegistration;
  sent: { content: string; customType: string; details: unknown }[];
  session: AdvisorSessionState;
}

const harness = (
  classifier: () => Promise<ReturnType<typeof answers>>,
  options: {
    consultResult?: () => Promise<AdvisorConsultationResult>;
    notifications?: string[];
  } = {}
): Harness => {
  const session = new AdvisorSessionState();
  const sent: Harness["sent"] = [];
  let consults = 0;

  const registration: JevTurnGateRegistration = {
    activeTools: () => ["ask_advisor"],
    consult: async () => {
      consults += 1;

      const fallback: AdvisorConsultationResult = {
        adviceId: "id",
        markdown: "Proactive advice.",
        model: "test/advisor",
        thinkingText: "",
        trigger: "turn-gate",
        usage: { cost: { total: 0.081 }, input: 5000, output: 900 },
      };

      return (await options.consultResult?.()) ?? fallback;
    },
    deps: { classifyResult: classifier },
    send: (message) => sent.push(message),
    session,
  };

  return { consultCount: () => consults, registration, sent, session };
};

const ctxWith = (notifications: string[] = []) =>
  asExtensionContext({
    cwd: "/",
    hasUI: true,
    isProjectTrusted: () => false,
    modelRegistry: {},
    sessionManager: {
      getBranch: () => branchFromLines([["user", "Do the work."]]),
    },
    signal: idleSignal(),
    ui: {
      notify: (message: string) => notifications.push(message),
      setStatus: () => {},
    },
  });

const turn = (h: Harness, ctx?: ExtensionContext) =>
  handleJevTurnEnd(h.registration, ctx ?? ctxWith());

beforeEach(() => {
  setAdvisorJevTurnGateEveryTurnsRef(2);
  setAdvisorJevTurnGateNoulThresholdRef(0.8);
  setAdvisorJevClassifierRef("typesafe/jev-latest");
  resetJevTurnGateNotification();
});

afterEach(() => {
  setAdvisorJevTurnGateEveryTurnsRef(0);
  setAdvisorJevTurnGateNoulThresholdRef(0.8);
  setAdvisorJevClassifierRef(undefined);
  setAdvisorMaxCallsPerSessionRef(undefined);
  setSimpleModeRef(false);
  resetConfigCache();
});

describe("handleJevTurnEnd", () => {
  test("counts turns without consultation and fires only on the interval", async () => {
    const h = harness(async () => answers(0.9));
    await turn(h);
    expect(h.session.turnsSinceConsultation).toBe(1);
    expect(h.sent).toEqual([]);
    await turn(h);
    expect(h.session.turnsSinceConsultation).toBe(0);
    expect(h.sent.map((message) => message.customType)).toEqual([
      "advisor-turn-gate-call",
      "advisor-turn-gate-result",
    ]);
  });

  test("honors threshold boundaries and malformed classifier failures", async () => {
    const confident = harness(async () => answers(0.8));
    await turn(confident);
    await turn(confident);
    expect(confident.consultCount()).toBe(1);

    const uncertain = harness(async () => answers(0.79));
    await turn(uncertain);
    await turn(uncertain);
    expect(uncertain.consultCount()).toBe(0);

    const failed = harness(async () => {
      throw new Error("malformed response");
    });

    const notices: string[] = [];
    await turn(failed, ctxWith(notices));
    await turn(failed, ctxWith(notices));
    expect(failed.consultCount()).toBe(0);
    expect(notices[0]).toContain("malformed response");
  });

  test("a confident gate consultation consumes budget and records local usage", async () => {
    const h = harness(async () => answers(0.9));
    await turn(h);
    await turn(h);
    expect(h.consultCount()).toBe(1);
    expect(h.session.consumedCalls).toBe(1);
    expect(h.session.turnsSinceConsultation).toBe(0);
    expect(h.session.sessionTurnOrdinal).toBe(2);
    expect(h.session.summary(undefined)).toContain("1 consultation");
  });

  test("consultation postpones the next gate check", async () => {
    const h = harness(async () => answers(0.9));
    await turn(h);
    h.session.resetTurnsSinceConsultation();
    await turn(h);
    expect(h.sent).toEqual([]);
    await turn(h);
    expect(h.sent.length).toBeGreaterThan(0);
  });

  test("budget is rechecked after classification", async () => {
    setAdvisorMaxCallsPerSessionRef(1);
    const response = deferred<ReturnType<typeof answers>>();
    const started = deferred<boolean>();

    const h = harness(() => {
      started.resolve(true);

      return response.promise;
    });

    await turn(h);
    const pending = turn(h);
    await started.promise;
    expect(h.session.reserveCall("pending-ask", 1)).toBe(true);
    response.resolve(answers(0.9));
    await pending;
    expect(h.consultCount()).toBe(0);
    expect(h.session.consumedCalls).toBe(0);
    h.session.releaseCall("pending-ask");
  });

  test("off interval, simple mode, inactive tool, and budget exhaustion suppress checks", async () => {
    const h = harness(async () => answers(0.9));
    setAdvisorMaxCallsPerSessionRef(0);
    const notices: string[] = [];
    await turn(h);
    await turn(h, ctxWith(notices));
    expect(h.consultCount()).toBe(0);
    expect(notices).toEqual([]);

    setAdvisorJevTurnGateEveryTurnsRef(0);
    const off = harness(async () => answers(0.9));
    await turn(off);
    await turn(off);
    expect(off.sent).toEqual([]);

    setAdvisorJevTurnGateEveryTurnsRef(2);
    setAdvisorMaxCallsPerSessionRef(undefined);
    setSimpleModeRef(true);
    const simple = harness(async () => answers(0.9));
    await turn(simple);
    await turn(simple);
    expect(simple.sent).toEqual([]);

    setSimpleModeRef(false);
    const inactive = harness(async () => answers(0.9));
    inactive.registration.activeTools = () => [];
    await turn(inactive);
    await turn(inactive);
    expect(inactive.sent).toEqual([]);
  });

  test("classifier and consultation failures are visible and fail open", async () => {
    const notices: string[] = [];

    const classifierFailure = harness(async () => {
      throw new Error("classifier unavailable");
    });

    await turn(classifierFailure, ctxWith(notices));
    await turn(classifierFailure, ctxWith(notices));
    expect(classifierFailure.consultCount()).toBe(0);
    expect(notices[0]).toContain("classifier unavailable");

    const consultationFailure = harness(async () => answers(0.9), {
      consultResult: () => Promise.reject(new Error("advisor unavailable")),
    });

    await turn(consultationFailure, ctxWith(notices));
    await turn(consultationFailure, ctxWith(notices));
    expect(consultationFailure.consultCount()).toBe(1);
  });

  test("missing selected classifier notifies once", async () => {
    setAdvisorJevClassifierRef(undefined);
    const notices: string[] = [];
    const h = harness(async () => answers(0.9));
    h.registration.deps = undefined;
    await turn(h, ctxWith(notices));
    await turn(h, ctxWith(notices));
    expect(notices[0]).toContain("(auth)");
  });
});
