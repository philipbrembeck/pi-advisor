import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Fetch } from "@typesafe-ai/sdk";

import {
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
import { branchFromLines, systemOneMock } from "./helpers/jev-mock.ts";

const credentials = { apiKey: "tsk-test", transport: "typesafe" as const };

const deferred = <Value>() => {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: Value) => resolvePromise?.(value),
  };
};

const noulResponse = (noul: number) => ({
  answers: { should_consult: { noul, type: "noul" } },
  usage: { input_tokens: 800, output_tokens: 0 },
});

const idleSignal = () => new AbortController().signal;

interface Harness {
  consultCount: () => number;
  registration: JevTurnGateRegistration;
  sent: { content: string; customType: string; details: unknown }[];
  session: AdvisorSessionState;
}

const harness = (
  fetch: Fetch,
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
    deps: {
      fetch,
      resolveTransport: () => Promise.resolve(credentials),
    },
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
  resetJevTurnGateNotification();
});

afterEach(() => {
  setAdvisorJevTurnGateEveryTurnsRef(0);
  setAdvisorJevTurnGateNoulThresholdRef(0.8);
  setAdvisorMaxCallsPerSessionRef(undefined);
  setSimpleModeRef(false);
  resetConfigCache();
});

describe("handleJevTurnEnd", () => {
  test("counts turns without consultation and fires only on the interval", async () => {
    const h = harness(systemOneMock([noulResponse(0.9)]).fetch);
    await turn(h);
    expect(h.session.turnsSinceConsultation).toBe(1);
    expect(h.sent).toEqual([]);
    await turn(h);
    expect(h.session.turnsSinceConsultation).toBe(0);
    expect(h.sent.map((m) => m.customType)).toEqual([
      "advisor-turn-gate-call",
      "advisor-turn-gate-result",
    ]);
  });

  test("a confident-true verdict runs a consultation that consumes budget", async () => {
    const h = harness(systemOneMock([noulResponse(0.9)]).fetch);
    await turn(h);
    await turn(h);
    expect(h.consultCount()).toBe(1);
    expect(h.session.consumedCalls).toBe(1);
    expect(h.session.turnsSinceConsultation).toBe(0);
    expect(h.session.sessionTurnOrdinal).toBe(2);
    const summary = h.session.summary(undefined) ?? "";
    expect(summary).toContain("Turn gate: 1 check");
    expect(summary).toContain("1 consultation");
  });

  test("a consultation from any path postpones the next check", async () => {
    const h = harness(systemOneMock([noulResponse(0.9)]).fetch);
    await turn(h);
    h.session.resetTurnsSinceConsultation();
    await turn(h);
    expect(h.sent).toEqual([]);
    await turn(h);
    expect(h.sent.length).toBeGreaterThan(0);
  });

  test("uncertainty or a low noul means status quo with no notification", async () => {
    const notifications: string[] = [];
    const h = harness(systemOneMock([noulResponse(0.79)]).fetch);
    await turn(h);
    await turn(h, ctxWith(notifications));
    expect(h.consultCount()).toBe(0);
    expect(notifications).toEqual([]);
  });

  test("a 401 notifies once per outage and never consults", async () => {
    const notifications: string[] = [];
    const mock = systemOneMock([{ body: { error: "bad key" }, status: 401 }]);
    const h = harness(mock.fetch);
    const ctx = ctxWith(notifications);
    await turn(h, ctx);
    await turn(h, ctx);
    await turn(h, ctx);
    await turn(h, ctx);
    expect(h.consultCount()).toBe(0);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("(auth)");
  });

  test("rechecks the budget after Jev returns before consuming a call", async () => {
    setAdvisorMaxCallsPerSessionRef(1);
    const response = deferred<Response>();
    const started = deferred<undefined>();
    const h = harness(() => {
      started.resolve(undefined);
      return response.promise;
    });
    await turn(h);
    const pendingCheck = turn(h);
    await started.promise;
    expect(h.session.reserveCall("pending-ask", 1)).toBe(true);
    response.resolve(Response.json(noulResponse(0.9)));
    await pendingCheck;

    expect(h.consultCount()).toBe(0);
    expect(h.session.consumedCalls).toBe(0);
    h.session.releaseCall("pending-ask");
  });

  test("budget exhaustion skips the check silently", async () => {
    setAdvisorMaxCallsPerSessionRef(0);
    const notifications: string[] = [];
    const h = harness(systemOneMock([noulResponse(0.95)]).fetch);
    await turn(h);
    await turn(h, ctxWith(notifications));
    expect(h.consultCount()).toBe(0);
    expect(notifications).toEqual([]);
    expect(h.session.summary(undefined)).toBeUndefined();
  });

  test("an off interval (0) never checks", async () => {
    setAdvisorJevTurnGateEveryTurnsRef(0);
    const h = harness(systemOneMock([noulResponse(0.95)]).fetch);
    await turn(h);
    await turn(h);
    expect(h.sent).toEqual([]);
    expect(h.session.turnsSinceConsultation).toBe(2);
  });

  test("simple mode and inactive ask_advisor suppress the gate", async () => {
    setSimpleModeRef(true);
    const off = harness(systemOneMock([noulResponse(0.95)]).fetch);
    await turn(off);
    await turn(off);
    expect(off.sent).toEqual([]);
    setSimpleModeRef(false);
    const inactive: Harness = {
      ...harness(systemOneMock([noulResponse(0.95)]).fetch),
    };
    inactive.registration.activeTools = () => [];
    await turn(inactive);
    await turn(inactive);
    expect(inactive.sent).toEqual([]);
  });

  test("a consultation failure records a gate failure and notifies once", async () => {
    const notifications: string[] = [];
    const h = harness(systemOneMock([noulResponse(0.95)]).fetch, {
      consultResult: () => Promise.reject(new Error("provider down")),
    });
    const ctx = ctxWith(notifications);
    await turn(h, ctx);
    await turn(h, ctx);
    expect(h.consultCount()).toBe(1);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("provider down");
    const summary = h.session.summary(undefined) ?? "";
    expect(summary).toContain("Turn gate: 1 check");
  });

  test("missing credentials notify once with missing-key", async () => {
    const notifications: string[] = [];
    const session = new AdvisorSessionState();
    const registration: JevTurnGateRegistration = {
      activeTools: () => ["ask_advisor"],
      consult: () =>
        Promise.resolve({
          adviceId: "unused",
          markdown: "",
          model: "unused",
          thinkingText: "",
          trigger: "turn-gate",
        }),
      deps: { resolveTransport: () => Promise.resolve(undefined) },
      send: () => undefined,
      session,
    };
    const ctx = ctxWith(notifications);
    await handleJevTurnEnd(registration, ctx);
    await handleJevTurnEnd(registration, ctx);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("missing-key");
  });
});
