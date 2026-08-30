import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import { controlJudge, defaultControlAdvice } from "../src/controls.js";
import {
  advisorContextForItem,
  assertAdvisorPayloadExcludesKey,
} from "../src/decision-context.js";
import { runDecisions } from "../src/decisions.js";
import { discoverDecisionItems } from "../src/fixture.js";
import { MockProviderServer } from "../src/replay/mock-provider.js";
import { parseJudgeResponse } from "../src/score/judge.js";
import { mechanicalScore } from "../src/score/mechanical.js";

const items = discoverDecisionItems("bench/tasks");

describe("Tier 2 decision corpus", () => {
  test("contains the preregistered polarity split and complete item shape", () => {
    expect(items).toHaveLength(24);
    expect(items.filter((item) => item.polarity === "positive")).toHaveLength(
      12
    );
    expect(items.filter((item) => item.polarity === "negative")).toHaveLength(
      12
    );
    for (const item of items) {
      expect(item.conversation.length).toBeGreaterThan(0);
      expect(item.draft.length).toBeGreaterThan(0);
      expect(item.repoPath).toContain("/repo");
      expect(item.key.targetFile.length).toBeGreaterThan(0);
      expect(item.key.targetSymbol.length).toBeGreaterThan(0);
      expect(item.provenance.reactBenchCommit).toBe(
        "11ff042e60ec83a613053fbd721a54ed4dbfdf6f"
      );
    }
  });

  test("keeps scorer keys out of Advisor context", () => {
    for (const item of items) {
      const prompt = advisorContextForItem(item);
      expect(prompt).not.toContain("key/answer.toml");
      expect(prompt).not.toContain("key/traps.toml");
      expect(() => assertAdvisorPayloadExcludesKey(item, prompt)).not.toThrow();
    }
  });

  test("uses mechanical location checks only for positives", () => {
    const positive = items.find((item) => item.polarity === "positive");
    const negative = items.find((item) => item.polarity === "negative");
    if (!(positive && negative)) {
      throw new Error("Expected both decision polarities.");
    }
    expect(
      mechanicalScore(
        positive,
        `${positive.key.targetFile} ${positive.key.targetSymbol}`
      )
    ).toBe(true);
    expect(
      mechanicalScore(negative, "mentions every possible concern")
    ).toBeNull();
  });

  test("separates deterministic null and oracle controls", async () => {
    const report = await runDecisions({
      announceBudget: false,
      reportTimestamp: "2026-08-29T00:00:00.000Z",
      writeReportOutput: false,
    });
    expect(report.status).toBe("PASS");
    expect(report.controls).toMatchObject({
      invalid: false,
      nullCatchRate: 0,
      oracleCatchRate: 1,
      oracleFalseAlarmRate: 0,
    });
    expect(report.metrics).toMatchObject({
      itemCount: 24,
      polarityCounts: { negative: 12, positive: 12 },
    });
  });

  test("aborts before live work when the estimate exceeds the cap", async () => {
    const pricing = Object.fromEntries(
      Object.keys(DEFAULT_CONFIG.modelPins).map((name) => [
        DEFAULT_CONFIG.modelPins[name].model,
        {
          cacheReadPerMillion: 1,
          cacheWritePerMillion: 1,
          inputPerMillion: 1,
          outputPerMillion: 1,
        },
      ])
    );
    await expect(
      runDecisions({
        announceBudget: false,
        config: { ...DEFAULT_CONFIG, budgetUsd: 0.000_001, pricing },
        live: true,
        writeReportOutput: false,
      })
    ).rejects.toThrow("exceeds");
  });

  test("runs all four live arms against a local provider and records pins", async () => {
    const server = await new MockProviderServer({
      replyFor: (body) => ({
        text: JSON.stringify(
          JSON.stringify(body).includes("judge")
            ? { justification: "Local judge control.", pass: true }
            : "Local Advisor response."
        ),
        usage: { input: 1, output: 1, totalTokens: 2 },
      }),
    }).start();
    const pricing = Object.fromEntries(
      Object.values(DEFAULT_CONFIG.modelPins).map((pin) => [
        pin.model,
        {
          cacheReadPerMillion: 1,
          cacheWritePerMillion: 1,
          inputPerMillion: 1,
          outputPerMillion: 1,
        },
      ])
    );
    const previousBaseUrl = process.env.BENCH_BASE_URL;
    const previousKey = process.env.BENCH_API_KEY;
    const previousScout = process.env.BENCH_SCOUT;
    process.env.BENCH_BASE_URL = server.baseUrl;
    process.env.BENCH_API_KEY = "local-test-key";
    process.env.BENCH_SCOUT = "1";
    try {
      const report = await runDecisions({
        announceBudget: false,
        config: { ...DEFAULT_CONFIG, pricing },
        live: true,
        writeReportOutput: false,
      });
      expect(report.status).toBe("PASS");
      expect(report.controls).toMatchObject({
        invalid: false,
        oracleCatchRate: 1,
      });
      expect(report.metrics).toMatchObject({ live: true });
      expect(report.metrics.pinRequests).toHaveLength(504);
      expect(report.metrics.scout).toMatchObject({
        advisorInputTokens: { delta: expect.any(Number) },
        J: { delta: expect.any(Number) },
        spend: { off: expect.anything(), on: expect.anything() },
        status: "complete",
      });
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.BENCH_BASE_URL;
      } else {
        process.env.BENCH_BASE_URL = previousBaseUrl;
      }
      if (previousKey === undefined) {
        delete process.env.BENCH_API_KEY;
      } else {
        process.env.BENCH_API_KEY = previousKey;
      }
      if (previousScout === undefined) {
        delete process.env.BENCH_SCOUT;
      } else {
        process.env.BENCH_SCOUT = previousScout;
      }
      await server.close();
    }
  });

  test("requires explicit judge JSON and keeps negative control semantics narrow", () => {
    expect(
      parseJudgeResponse('{"pass":true,"justification":"specific"}')
    ).toEqual({
      justification: "specific",
      pass: true,
    });
    expect(() => parseJudgeResponse("yes")).toThrow("JSON object");
    const negative = items.find((item) => item.polarity === "negative");
    if (!negative) {
      throw new Error("Expected a negative decision item.");
    }
    expect(
      controlJudge(negative, defaultControlAdvice("oracle", negative))
    ).toBe(true);
    expect(controlJudge(negative, negative.traps[0].tokens.join(" "))).toBe(
      false
    );
  });
});
