import { describe, expect, test } from "bun:test";
import {
  createHerdrNotificationRequest,
  HerdrAdvisorActivity,
  HerdrAdvisorBlock,
  setHerdrBlockedEmitter,
} from "../src/herdr.ts";

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
    expect(Object.keys(request).sort()).toEqual(["id", "method", "params"]);
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
    expect(Object.keys(reports[0].params).sort()).toEqual([
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

  test("emits one herdr:blocked edge per block and one clear", () => {
    const events: boolean[] = [];
    setHerdrBlockedEmitter((active) => events.push(active));
    try {
      const block = new HerdrAdvisorBlock(
        () => undefined,
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
