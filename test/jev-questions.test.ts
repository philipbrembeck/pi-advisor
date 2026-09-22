import { describe, expect, test } from "bun:test";

import {
  composeScreeningVerdict,
  composeTurnGateVerdict,
  lowestStakesProbability,
  STAKES_RUBRIC,
} from "../src/jev/questions.ts";

const [L0, L1, L2] = STAKES_RUBRIC;

const scoreAnswer = (
  probabilities: Record<string, number>,
  legend?: Record<string, string>,
  score = 1
) => ({
  confidence: 0.9,
  ...(legend ? { legend } : {}),
  probabilities,
  score,
  type: "score",
});

const criteria = { noulMargin: 0.35, skipConfidence: 0.85 };

describe("lowestStakesProbability", () => {
  test("resolves level 0 through a 0-indexed legend", () => {
    expect(
      lowestStakesProbability(
        scoreAnswer(
          { "0": 0.12, "1": 0.7, "2": 0.18 },
          { "0": L0, "1": L1, "2": L2 }
        )
      )
    ).toBe(0.12);
  });

  test("resolves level 0 through a 1-indexed legend", () => {
    expect(
      lowestStakesProbability(
        scoreAnswer(
          { "1": 0.9, "2": 0.08, "3": 0.02 },
          { "1": L0, "2": L1, "3": L2 }
        )
      )
    ).toBe(0.9);
  });

  test("resolves level 0 through label keys", () => {
    expect(
      lowestStakesProbability(
        scoreAnswer(
          { high: 0.01, moderate: 0.09, negligible: 0.9 },
          { high: L2, moderate: L1, negligible: L0 }
        )
      )
    ).toBe(0.9);
  });

  test("falls back to the smallest numeric index when the legend is absent", () => {
    expect(lowestStakesProbability(scoreAnswer({ "0": 0.4, "1": 0.6 }))).toBe(
      0.4
    );
    expect(lowestStakesProbability(scoreAnswer({ "1": 0.4, "2": 0.6 }))).toBe(
      0.4
    );
  });

  test("returns undefined for unresolvable shapes", () => {
    expect(
      lowestStakesProbability(
        scoreAnswer({ high: 0.1, low: 0.9 }, { other: L0 })
      )
    ).toBeUndefined();
    expect(lowestStakesProbability(scoreAnswer({}))).toBeUndefined();
    expect(lowestStakesProbability("garbage")).toBeUndefined();
  });
});

describe("composeScreeningVerdict", () => {
  test("skips only on the hard conjunction", () => {
    expect(
      composeScreeningVerdict(
        {
          self_answerable: { noul: 0.9 },
          stakes: { legend: { "0": L0 }, probabilities: { "0": 0.95 } },
        },
        criteria
      )
    ).toEqual({ skip: true });
    expect(
      composeScreeningVerdict(
        {
          self_answerable: { noul: 0.9 },
          stakes: { legend: { "0": L0 }, probabilities: { "0": 0.84 } },
        },
        criteria
      )
    ).toEqual({ skip: false });
    expect(
      composeScreeningVerdict(
        {
          self_answerable: { noul: 0.84 },
          stakes: { legend: { "0": L0 }, probabilities: { "0": 0.95 } },
        },
        criteria
      )
    ).toEqual({ skip: false });
  });

  test("a 1.1–1.3 float score with high lowest-level mass still skips", () => {
    expect(
      composeScreeningVerdict(
        {
          self_answerable: { noul: 0.9 },
          stakes: {
            legend: { "0": L0, "1": L1, "2": L2 },
            probabilities: { "0": 0.9, "1": 0.08, "2": 0.02 },
            score: 1.3,
          },
        },
        criteria
      )
    ).toEqual({ skip: true });
  });

  test("moderate mass on any higher level does not skip", () => {
    expect(
      composeScreeningVerdict(
        {
          self_answerable: { noul: 0.95 },
          stakes: {
            legend: { "0": L0, "1": L1, "2": L2 },
            probabilities: { "0": 0.1, "1": 0.85, "2": 0.05 },
            score: 1.1,
          },
        },
        criteria
      )
    ).toEqual({ skip: false });
  });

  test("every malformed or missing input allows", () => {
    for (const invalid of [
      undefined,
      null,
      "answers",
      {},
      { stakes: {} },
      { self_answerable: {} },
      {
        self_answerable: { noul: Number.NaN },
        stakes: { legend: { "0": L0 }, probabilities: { "0": 0.95 } },
      },
      {
        self_answerable: { noul: 0.9 },
        stakes: {
          legend: { "0": "unrelated text" },
          probabilities: { x: 0.95 },
        },
      },
      {
        self_answerable: { noul: 0.9 },
        stakes: { legend: { "0": L0 }, probabilities: { "0": "not a number" } },
      },
    ]) {
      expect(composeScreeningVerdict(invalid, criteria)).toEqual({
        skip: false,
      });
    }
  });

  test("the noul margin rule requires clearance over a coin flip", () => {
    const at = (margin: number) =>
      composeScreeningVerdict(
        {
          self_answerable: { noul: margin },
          stakes: { legend: { "0": L0 }, probabilities: { "0": 0.99 } },
        },
        criteria
      );
    expect(at(0.849)).toEqual({ skip: false });
    expect(at(0.85)).toEqual({ skip: true });
  });
});

describe("composeTurnGateVerdict", () => {
  test("fires only at or above the confident-true threshold", () => {
    const answers = (noul: number) => ({ should_consult: { noul } });
    expect(composeTurnGateVerdict(answers(0.79), 0.8)).toBe(false);
    expect(composeTurnGateVerdict(answers(0.8), 0.8)).toBe(true);
    expect(composeTurnGateVerdict(answers(undefined as never), 0.8)).toBe(
      false
    );
    expect(composeTurnGateVerdict({}, 0.8)).toBe(false);
  });
});
