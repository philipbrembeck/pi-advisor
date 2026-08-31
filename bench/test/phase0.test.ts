import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BudgetExceededError,
  BudgetGuard,
  validateBudgetPlan,
} from "../src/budget.js";
import {
  DEFAULT_CONFIG,
  validateBenchmarkConfig,
  validatePricing,
} from "../src/config.js";
import { CostMeter, configuredCost, normalizeUsage } from "../src/cost.js";
import { hashTree } from "../src/fixture.js";
import {
  assertPinnedLiveModelConfiguration,
  assertRecordedRequestPin,
  capturePins,
} from "../src/pins.js";
import { readReport, reportFor, writeReport } from "../src/report.js";
import { UNAVAILABLE } from "../src/types.js";

describe("benchmark Phase 0 infrastructure", () => {
  test("validates the pinned default configuration and pricing", () => {
    expect(validateBenchmarkConfig(DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
    expect(() => validatePricing({ model: {} })).toThrow("provider/model");
    expect(() =>
      validateBenchmarkConfig({ ...DEFAULT_CONFIG, budgetUsd: 0 })
    ).toThrow("budgetUsd");
  });

  test("keeps missing provider usage unavailable and prices cache fields", () => {
    expect(normalizeUsage(undefined)).toMatchObject({
      input: null,
      usageAvailable: false,
    });
    const usage = normalizeUsage({
      cacheRead: 100,
      cacheWrite: 50,
      input: 1000,
      output: 500,
    });
    expect(usage.usageAvailable).toBe(true);
    expect(
      configuredCost(usage, {
        cacheReadPerMillion: 1,
        cacheWritePerMillion: 2,
        inputPerMillion: 3,
        outputPerMillion: 4,
      })
    ).toBe(0.0052);

    const meter = new CostMeter();
    meter.record(
      "advisor",
      "provider/model",
      { cacheRead: 0, cacheWrite: 0, input: 1, output: 2 },
      {
        cacheReadPerMillion: 0,
        cacheWritePerMillion: 0,
        inputPerMillion: 1,
        outputPerMillion: 1,
      }
    );
    expect(meter.totalConfiguredCost()).toBe(0.000_003);
    meter.record("advisor", "provider/model", undefined, {
      cacheReadPerMillion: 0,
      cacheWritePerMillion: 0,
      inputPerMillion: 1,
      outputPerMillion: 1,
    });
    expect(meter.totalConfiguredCost()).toBe(UNAVAILABLE);
  });

  test("reserves budget before requests and fails closed", () => {
    const guard = new BudgetGuard(0.02);
    guard.reserve(0.02);
    expect(() => guard.reserve(0.000_001)).toThrow(BudgetExceededError);
    expect(
      validateBudgetPlan({
        capUsd: 1,
        estimatedUsd: 0.25,
        expectedCalls: 2,
        maxCalls: 4,
        tokenAssumption: { input: 100, output: 50 },
      })
    ).toMatchObject({ capUsd: 1, estimatedUsd: 0.25 });
  });

  test("asserts model and effort from the recorded request", () => {
    const pin = {
      effort: "medium",
      model: "provider/model",
      role: "advisor" as const,
    };
    expect(
      assertRecordedRequestPin(
        { model: "model", provider: "provider", reasoning_effort: "medium" },
        pin
      )
    ).toBe(true);
    expect(() =>
      assertRecordedRequestPin(
        { model: "model", provider: "provider", reasoning_effort: "max" },
        pin
      )
    ).toThrow("Pinned request mismatch");
  });

  test("hashes fixture trees and round-trips versioned reports", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-advisor-bench-phase0-"));
    try {
      const fixture = join(root, "fixture.txt");
      writeFileSync(fixture, "fixture");
      expect(hashTree(root)).toBe(hashTree(root));
      const report = reportFor(
        "replay",
        DEFAULT_CONFIG,
        { cost: { usd: 0 } },
        {
          fixtureHashes: { root: hashTree(root) },
          generatedAt: "2026-08-29T00:00:00.000Z",
        }
      );
      const paths = writeReport(report, {
        json: join(root, "report.json"),
        markdown: join(root, "report.md"),
      });
      expect(readFileSync(paths.markdown, "utf8")).toContain(
        "Status: **PASS**"
      );
      expect(readReport(paths.json)).toMatchObject({
        schemaVersion: 1,
        tier: "replay",
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("rejects live configurations that change the preregistered pair", () => {
    expect(assertPinnedLiveModelConfiguration(DEFAULT_CONFIG)).toBe(true);
    expect(() =>
      assertPinnedLiveModelConfiguration({
        ...DEFAULT_CONFIG,
        modelPins: {
          ...DEFAULT_CONFIG.modelPins,
          executor: {
            ...DEFAULT_CONFIG.modelPins.executor,
            effort: "high",
          },
        },
      })
    ).toThrow("Live model pin executor");
  });

  test("captures every configured model pin and effort", () => {
    const pins = capturePins(DEFAULT_CONFIG);
    expect(pins.modelPins.executor).toMatchObject({
      effort: "max",
      model: "openai-codex/gpt-5.6-luna",
    });
    expect(pins.modelPins.decisionAdvisor).toMatchObject({ effort: "medium" });
  });
});
