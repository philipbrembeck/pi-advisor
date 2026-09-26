import { describe, expect, test } from "bun:test";

import {
  createHerdrNotificationRequest,
  HerdrAdvisorActivity,
  HerdrAdvisorBlock,
  setHerdrBlockedEmitter,
} from "../src/herdr.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { registerAdvisorTool } from "../src/tools.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { mockPi } from "./helpers/mock-pi.ts";

const blockedGate = async () => ({
  decision: "blocked" as const,
  markdown: "Decision: blocked\nStop.",
  model: "provider/advisor",
  ok: true as const,
  thinkingText: "",
  trigger: "repeated-tool-call" as const,
});

describe("Herdr Advisor activity", () => {
  test("constructs sanitized request notifications within Herdr limits", () => {
    const request = createHerdrNotificationRequest(
      "bad\n title",
      "  details\u0000 with   spacing "
    );
    expect(request.method).toBe("notification.show");
    expect(request.params).toEqual({
      body: "details with spacing",
      position: "top-left",
      sound: "request",
      title: "bad title",
    });
    expect(Object.keys(request).toSorted()).toEqual(["id", "method", "params"]);
    expect(request.params.title.length).toBeLessThanOrEqual(80);
    expect(request.params.body.length).toBeLessThanOrEqual(240);
  });
  test("keeps seeking advice visible until overlapping consultations finish", () => {
    const reports: any[] = [];
    const activity = new HerdrAdvisorActivity((request) =>
      reports.push(request)
    );

    activity.start();
    activity.start();
    activity.finish();
    expect(reports).toHaveLength(1);
    expect(reports[0].params).toMatchObject({
      agent: "pi",
      applies_to_source: "herdr:pi",
      state_labels: { working: "seeking advice" },
    });
    expect(Object.keys(reports[0].params).toSorted()).toEqual([
      "agent",
      "applies_to_source",
      "pane_id",
      "seq",
      "source",
      "state_labels",
    ]);

    activity.finish();
    expect(reports).toHaveLength(2);
    expect(reports[1].params).toMatchObject({ clear_state_labels: true });
    expect(reports[1].params).not.toHaveProperty("state_labels");
  });

  test("clears seeking advice on shutdown", () => {
    const reports: any[] = [];
    const activity = new HerdrAdvisorActivity((request) =>
      reports.push(request)
    );

    activity.start();
    activity.clear();
    activity.clear();

    expect(reports).toHaveLength(2);
    expect(reports[1].params).toMatchObject({ clear_state_labels: true });
  });

  test("runtime shutdown releases only that runtime's activity leases", () => {
    const reports: any[] = [];
    const manager = new HerdrAdvisorActivity((request) =>
      reports.push(request)
    );
    const runtimeA = manager.createScope();
    const runtimeB = manager.createScope();

    const finishA = runtimeA.start();
    const finishB1 = runtimeB.start();
    const finishB2 = runtimeB.start();
    runtimeB.clear();
    finishA();

    expect(reports).toHaveLength(2);
    expect(reports[0].params.state_labels).toEqual({
      working: "seeking advice",
    });
    expect(reports[1].params).toMatchObject({ clear_state_labels: true });
    finishB1();
    finishB2();
    expect(reports).toHaveLength(2);
  });

  test("ignores a late finish after a newer runtime activity starts", () => {
    const reports: any[] = [];
    const runtime = new HerdrAdvisorActivity((request) =>
      reports.push(request)
    ).createScope();
    const finishOld = runtime.start();
    runtime.clear();
    const finishNew = runtime.start();

    finishOld();
    expect(reports).toHaveLength(3);
    expect(reports[2].params.state_labels).toEqual({
      working: "seeking advice",
    });
    finishNew();
    expect(reports).toHaveLength(4);
    expect(reports[3].params).toMatchObject({ clear_state_labels: true });
  });

  test("does not report activity or blocked metadata when integration is disabled", () => {
    const reports: any[] = [];
    const activity = new HerdrAdvisorActivity(
      (request) => reports.push(request),
      () => false
    );
    activity.start();
    activity.finish();
    expect(reports).toHaveLength(0);
  });

  test("does not let unavailable Herdr reporting interrupt advice", () => {
    const activity = new HerdrAdvisorActivity(() => {
      throw new Error("socket unavailable");
    });

    expect(() => activity.start()).not.toThrow();
    expect(() => activity.finish()).not.toThrow();
  });

  test("redacts and bounds blocked labels and clears after integration is disabled", () => {
    const reports: any[] = [];
    let enabled = true;
    const block = new HerdrAdvisorBlock(
      (request) => reports.push(request),
      () => enabled
    );
    block.set(`token=super-secret-token-value\n${"x".repeat(500)}`);
    enabled = false;
    block.clear();
    block.clear();

    expect(reports).toHaveLength(2);
    expect(reports[0].params.state_labels.blocked).toContain(
      "[REDACTED SECRET]"
    );
    expect(reports[0].params.state_labels.blocked).not.toContain(
      "super-secret-token-value"
    );
    expect(reports[0].params.state_labels.blocked.length).toBeLessThanOrEqual(
      200
    );
    expect(reports[1].params).toMatchObject({ clear_state_labels: true });
  });

  test("uses each runtime's own herdr:blocked emitter", () => {
    const eventsA: boolean[] = [];
    const eventsB: boolean[] = [];
    const blockA = new HerdrAdvisorBlock(
      () => {},
      () => true,
      (active) => eventsA.push(active)
    );
    const blockB = new HerdrAdvisorBlock(
      () => {},
      () => true,
      (active) => eventsB.push(active)
    );

    blockA.set("runtime A blocked");
    blockB.set("runtime B blocked");
    blockA.clear();

    expect(eventsA).toEqual([true, false]);
    expect(eventsB).toEqual([true]);
    blockB.clear();
    expect(eventsB).toEqual([true, false]);
  });

  test("routes automatic blocked events to their registering runtime", async () => {
    await withAgentDir(
      { advisorLoopThreshold: 2, gateFailureMode: "block-session" },
      async (agentDir) => {
        const eventsA = new Map<string, any>();
        const eventsB = new Map<string, any>();
        const receivedA: { active: boolean; label: string }[] = [];
        const receivedB: { active: boolean; label: string }[] = [];
        const blockA = new HerdrAdvisorBlock(
          () => {},
          () => true,
          (active, label) => receivedA.push({ active, label })
        );
        const blockB = new HerdrAdvisorBlock(
          () => {},
          () => true,
          (active, label) => receivedB.push({ active, label })
        );
        registerAdvisorTool(
          mockPi({ activeTools: ["ask_advisor"], events: eventsA }),
          new AdvisorSessionState(),
          { herdrBlock: blockA, runGate: blockedGate }
        );
        registerAdvisorTool(
          mockPi({ activeTools: ["ask_advisor"], events: eventsB }),
          new AdvisorSessionState(),
          { herdrBlock: blockB, runGate: blockedGate }
        );
        const ctx = asExtensionContext({
          abort: () => {},
          cwd: agentDir,
          hasUI: false,
          isProjectTrusted: () => false,
          signal: new AbortController().signal,
        });
        const toolCallA = eventsA.get("tool_call");
        await toolCallA(
          { input: { command: "pwd" }, toolCallId: "a-1", toolName: "bash" },
          ctx
        );
        await toolCallA(
          { input: { command: "pwd" }, toolCallId: "a-2", toolName: "bash" },
          ctx
        );

        expect(receivedA.map(({ active }) => active)).toEqual([true]);
        expect(receivedB).toEqual([]);
        eventsA.get("session_shutdown")({}, ctx);
        expect(receivedA.map(({ active }) => active)).toEqual([true, false]);
        expect(receivedB).toEqual([]);
      }
    );
  });

  test("emits one herdr:blocked edge per block and one clear", () => {
    const events: boolean[] = [];
    setHerdrBlockedEmitter((active) => events.push(active));
    try {
      const block = new HerdrAdvisorBlock(
        () => {},
        () => true
      );
      block.set("first");
      block.set("second");
      block.clear();
      block.clear();

      expect(events).toEqual([true, false]);
    } finally {
      setHerdrBlockedEmitter(undefined);
    }
  });
});
