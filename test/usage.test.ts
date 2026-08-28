import { describe, expect, test } from "bun:test";
import {
  addAdvisorUsage,
  advisorUsageForPi,
  emptyAdvisorUsageTotals,
  formatAdvisorUsage,
  formatAdvisorUsageStatus,
  formatAdvisorUsageTotals,
  snapshotAdvisorUsage,
} from "../src/usage.js";

describe("Advisor usage", () => {
  test("normalizes complete and legacy provider usage", () => {
    expect(
      snapshotAdvisorUsage({
        cacheRead: 20,
        cacheWrite: 3,
        cost: { total: 0.012_34 },
        input: 1200,
        output: 456,
        totalTokens: 1656,
      })
    ).toEqual({
      cacheRead: 20,
      cacheWrite: 3,
      cost: 0.012_34,
      input: 1200,
      output: 456,
      totalTokens: 1656,
    });
    expect(snapshotAdvisorUsage({ totalCost: 0.5 })).toEqual({ cost: 0.5 });
  });

  test("keeps valid partial usage and rejects malformed values", () => {
    expect(
      snapshotAdvisorUsage({
        cacheRead: Number.NaN,
        cost: { input: 0, total: Number.POSITIVE_INFINITY },
        input: 12,
        output: "unknown",
      })
    ).toEqual({ input: 12 });
    expect(snapshotAdvisorUsage({ cost: { input: 0 } })).toEqual({});
    expect(
      snapshotAdvisorUsage({ input: -1, totalCost: -0.1 })
    ).toBeUndefined();
    expect(snapshotAdvisorUsage({ input: Number.NaN })).toBeUndefined();
    expect(snapshotAdvisorUsage(undefined)).toBeUndefined();
  });

  test("formats individual usage without treating missing fields as zero", () => {
    expect(
      formatAdvisorUsage({
        cost: { total: 0.012_34 },
        input: 1200,
        output: 456,
      })
    ).toBe("↑1.2k · ↓456 · $0.0123");
    expect(formatAdvisorUsage({})).toBeUndefined();
  });

  test("aggregates known usage and reports calls without usage data", () => {
    const totals = emptyAdvisorUsageTotals();
    addAdvisorUsage(totals, {
      cost: { total: 0.01 },
      input: 1000,
      output: 100,
    });
    addAdvisorUsage(totals, undefined);

    expect(totals).toEqual({
      calls: 2,
      cost: 0.01,
      costCalls: 1,
      input: 1000,
      knownCalls: 1,
      output: 100,
    });
    expect(formatAdvisorUsageTotals(totals)).toBe(
      "↑1.0k · ↓100 · $0.0100 · 1 without usage data"
    );
    expect(formatAdvisorUsageStatus(totals)).toBe(
      "Advisor: 2 calls · ↑1.0k · ↓100 · $0.0100 · 1 without usage data"
    );
  });

  test("converts partial and zero-cost usage to Pi's complete shape", () => {
    expect(
      advisorUsageForPi({
        cost: { cacheRead: 0.001, input: 0.01, total: 0.012_34 },
        input: 1200,
        output: 456,
      })
    ).toEqual({
      cacheRead: 0,
      cacheWrite: 0,
      cost: {
        cacheRead: 0.001,
        cacheWrite: 0,
        input: 0.01,
        output: 0,
        total: 0.012_34,
      },
      input: 1200,
      output: 456,
      totalTokens: 1656,
    });
    expect(advisorUsageForPi({ input: 0, output: 0, totalCost: 0 })).toEqual({
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    });
    expect(advisorUsageForPi({})).toBeUndefined();
  });
});
