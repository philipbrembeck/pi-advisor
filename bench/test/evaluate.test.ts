import { describe, expect, test } from "bun:test";
import {
  aggregateEvaluation,
  breakEvenConsultations,
  type CostQualityPoint,
  dominanceVerdict,
  type EvaluationOutcome,
  exactMcNemarPValue,
  q2Report,
  renderCostQualityPlot,
  reweightCostQuality,
} from "../src/evaluate.js";
import { parseReactBenchResult } from "../src/reactbench.js";
import {
  candidateBandPrevalence,
  classifyCandidateBand,
  classifyScreeningPool,
  selectTrivialStratum,
} from "../src/screening.js";

const outcome = (
  taskId: string,
  arm: EvaluationOutcome["arm"],
  seed: number,
  passed: boolean
): EvaluationOutcome => ({
  arm,
  consultations: arm === "E+A" ? 1 : 0,
  cost: arm === "E+A" ? 0.02 : 0.01,
  passed,
  seed,
  taskId,
});

describe("Tier 3 statistics", () => {
  test("applies the preregistered candidate band proxy", () => {
    expect(classifyCandidateBand([false, false], [true, false])).toBe(
      "candidate-uplift"
    );
    expect(classifyCandidateBand([true, false], [false, false])).toBe(
      "trivial"
    );
    expect(classifyCandidateBand([false, false], [false, false])).toBe(
      "out-of-reach"
    );
    const results = classifyScreeningPool([
      {
        executorPasses: [false, false],
        frontierPasses: [true, false],
        taskId: "b",
      },
      {
        executorPasses: [true, true],
        frontierPasses: [true, true],
        taskId: "a",
      },
    ]);
    expect(candidateBandPrevalence(results)).toBe(0.5);
  });

  test("samples the trivial stratum deterministically", () => {
    const results = classifyScreeningPool([
      {
        executorPasses: [true, true],
        frontierPasses: [true, true],
        taskId: "a",
      },
      {
        executorPasses: [true, true],
        frontierPasses: [true, true],
        taskId: "b",
      },
      {
        executorPasses: [true, true],
        frontierPasses: [true, true],
        taskId: "c",
      },
    ]);
    expect(selectTrivialStratum(results, 2, 1)).toEqual(
      selectTrivialStratum(results, 2, 1)
    );
    expect(selectTrivialStratum(results, 2, 1)).toHaveLength(2);
  });

  test("aggregates five seeds before McNemar testing", () => {
    const outcomes: EvaluationOutcome[] = [];
    for (const seed of [101, 113, 127, 139, 151]) {
      outcomes.push(outcome("rescued", "E", seed, false));
      outcomes.push(outcome("rescued", "E+A", seed, seed !== 151));
      outcomes.push(outcome("regressed", "E", seed, true));
      outcomes.push(outcome("regressed", "E+A", seed, false));
    }
    const aggregates = aggregateEvaluation(outcomes);
    const report = q2Report(
      aggregates,
      { trivial: ["regressed"], uplift: ["rescued"] },
      outcomes
    );
    expect(report.taskLevel.all).toMatchObject({
      executorFailAdvisorPass: 1,
      executorPassAdvisorFail: 1,
      taskCount: 2,
    });
    expect(report.perSeed).toMatchObject({
      all: {
        executorFailAdvisorPass: 4,
        executorPassAdvisorFail: 5,
      },
      byStratum: {
        trivial: { executorFailAdvisorPass: 0, executorPassAdvisorFail: 5 },
        uplift: { executorFailAdvisorPass: 4, executorPassAdvisorFail: 0 },
      },
    });
    expect(exactMcNemarPValue(1, 1)).toBe(1);
  });

  test("reweights Q3 and computes the pre-registered dominance rule", () => {
    const point = (
      arm: CostQualityPoint["arm"],
      costPerTask: number,
      passRate: number
    ): CostQualityPoint => ({ arm, costPerTask, passRate, taskCount: 3 });
    const reweighted = reweightCostQuality([
      {
        points: [point("E", 1, 0), point("E+A", 2, 0.8), point("F", 4, 1)],
        prevalence: 0.25,
      },
      {
        points: [point("E", 1, 1), point("E+A", 1.1, 1), point("F", 2, 1)],
        prevalence: 0.75,
      },
    ]);
    const flow = reweighted.find((value) => value.arm === "E+A");
    expect(flow).toMatchObject({
      arm: "E+A",
      passRate: 0.95,
      taskCount: 6,
    });
    expect(flow?.costPerTask).toBeCloseTo(1.325, 10);
    const verdict = dominanceVerdict(reweighted);
    expect(verdict.status).toBe("not-dominated");
    expect(verdict.flow.passRate).toBeGreaterThanOrEqual(
      0.9 * verdict.frontier.passRate
    );
    expect(breakEvenConsultations(1, 4, 0.5)).toBe(6);
    expect(renderCostQualityPlot(reweighted, "test")).toContain('role="img"');
    expect(() =>
      reweightCostQuality([
        {
          points: [point("E", 1, 0)],
          prevalence: 1,
        },
        {
          points: [],
          prevalence: 1,
        },
      ])
    ).toThrow("missing from a positive-prevalence stratum");
  });

  test("parses only the adapter result record", () => {
    expect(
      parseReactBenchResult(
        'log\nBENCH_RESULT={"passed":true,"requests":[]}',
        "task"
      )
    ).toEqual({
      consultations: 0,
      cost: "unavailable",
      passed: true,
      requests: [],
      taskId: "task",
    });
    expect(() => parseReactBenchResult("no result", "task")).toThrow(
      "BENCH_RESULT"
    );
  });
});
