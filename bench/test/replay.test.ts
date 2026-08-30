import { describe, expect, test } from "bun:test";
import { runReplay } from "../src/replay/runner.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/;

describe("Tier 1 replay", () => {
  test("runs the shipped gate path through the local provider", async () => {
    const report = await runReplay({
      announceBudget: false,
      reportTimestamp: "2026-08-29T00:00:00.000Z",
      writeReportOutput: false,
    });

    expect(report.status).toBe("PASS");
    expect(report.controls?.invalid).toBe(false);
    expect(report.metrics.gateConformance).toMatchObject({
      passed: 18,
      total: 18,
    });
    expect(report.metrics.privacy).toMatchObject({ leakCount: 0 });
    expect(report.metrics.determinism).toMatchObject({
      passed: true,
      recordedRequests: 36,
    });
    expect(report.pins.fixtureHashes.replay).toMatch(SHA256);
  });
});
