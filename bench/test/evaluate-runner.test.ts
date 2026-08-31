import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
  type EvaluationRunOptions,
  latestScreeningReport,
  runEvaluation,
} from "../src/evaluate-runner.js";
import { reportFor, writeReport } from "../src/report.js";

const trialCost = (arm: string) => {
  if (arm === "F") {
    return 0.5;
  }
  if (arm === "E+A") {
    return 0.2;
  }
  return 0.1;
};

describe("Stage 2 evaluation runner", () => {
  test("resolves the newest screening report to an absolute path", () => {
    const root = mkdtempSync(
      join(process.env.TMPDIR ?? "/tmp", "bench-latest-")
    );
    try {
      const path = join(root, "2026-08-29T00-00-00-000Z-screen.json");
      writeFileSync(path, "{}");
      expect(latestScreeningReport(root)).toBe(path);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("reports an empty candidate band as valid no headroom", async () => {
    const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "bench-eval-"));
    try {
      const screening = reportFor(
        "screen",
        DEFAULT_CONFIG,
        {
          candidateBandPrevalence: 0,
          evaluationSeeds: [101, 113, 127, 139, 151],
          screeningSeeds: [11, 23],
          tasks: [
            {
              candidateBand: "trivial",
              executorPasses: [true, true],
              frontierPasses: [true, true],
              taskId: "task-a",
            },
            {
              candidateBand: "trivial",
              executorPasses: [true, false],
              frontierPasses: [true, true],
              taskId: "task-b",
            },
            {
              candidateBand: "trivial",
              executorPasses: [true, true],
              frontierPasses: [true, true],
              taskId: "task-c",
            },
          ],
          trajectories: [
            ["task-a", "E", true],
            ["task-a", "F", true],
            ["task-b", "E", true],
            ["task-b", "F", true],
            ["task-c", "E", true],
            ["task-c", "F", true],
          ].flatMap(([taskId, arm, passed]) =>
            [11, 23].map((seed) => ({
              arm,
              cost: 0.1,
              passed: taskId === "task-b" && arm === "E" ? seed === 11 : passed,
              seed,
              taskId,
            }))
          ),
          trivialStratumTaskIds: ["task-a", "task-b", "task-c"],
        },
        {
          fixtureHashes: { reactBench: "reactbench-hash" },
          generatedAt: "2026-08-29T00:00:00.000Z",
        }
      );
      const paths = writeReport(screening, {
        json: join(root, "screen.json"),
        markdown: join(root, "screen.md"),
      });
      const report = await runEvaluation({
        reportTimestamp: "2026-08-29T00:00:00.000Z",
        screeningReportPath: paths.json,
        writeReportOutput: false,
      });
      expect(report.status).toBe("PASS");
      expect(report.metrics.verdict).toBe("NO HEADROOM");
      expect(report.metrics.q2).toBeDefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("keeps evaluation arms paired and emits both Q3 plots", async () => {
    const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "bench-eval-"));
    try {
      const trials = [
        ["candidate", "E", false, 0.1],
        ["candidate", "F", true, 0.5],
        ["trivial", "E", true, 0.1],
        ["trivial", "F", true, 0.5],
        ["trivial-2", "E", true, 0.1],
        ["trivial-2", "F", true, 0.5],
        ["trivial-3", "E", true, 0.1],
        ["trivial-3", "F", true, 0.5],
        ["out", "E", false, 0.1],
        ["out", "F", false, 0.5],
      ].flatMap(([taskId, arm, passed, cost]) =>
        [11, 23].map((seed) => ({
          arm,
          cost,
          passed: taskId === "candidate" && arm === "F" ? seed === 11 : passed,
          seed,
          taskId,
        }))
      );
      const screening = reportFor(
        "screen",
        DEFAULT_CONFIG,
        {
          candidateBandPrevalence: 0.2,
          evaluationSeeds: [101, 113, 127, 139, 151],
          screeningSeeds: [11, 23],
          tasks: [
            {
              candidateBand: "candidate-uplift",
              executorPasses: [false, false],
              frontierPasses: [true, false],
              taskId: "candidate",
            },
            {
              candidateBand: "trivial",
              executorPasses: [true, true],
              frontierPasses: [true, true],
              taskId: "trivial",
            },
            {
              candidateBand: "trivial",
              executorPasses: [true, true],
              frontierPasses: [true, true],
              taskId: "trivial-2",
            },
            {
              candidateBand: "trivial",
              executorPasses: [true, true],
              frontierPasses: [true, true],
              taskId: "trivial-3",
            },
            {
              candidateBand: "out-of-reach",
              executorPasses: [false, false],
              frontierPasses: [false, false],
              taskId: "out",
            },
          ],
          trajectories: trials,
          trivialStratumTaskIds: ["trivial", "trivial-2", "trivial-3"],
        },
        {
          fixtureHashes: { reactBench: "reactbench-hash" },
          generatedAt: "2026-08-29T00:00:00.000Z",
        }
      );
      const paths = writeReport(screening, {
        json: join(root, "screen.json"),
        markdown: join(root, "screen.md"),
      });
      const runner: EvaluationRunOptions["runner"] = {
        run: async (request) => ({
          consultations: request.arm === "E+A" ? 1 : 0,
          cost: trialCost(request.arm),
          passed:
            request.arm === "E+A" ||
            request.arm === "F" ||
            request.taskPath.includes("trivial"),
          taskId: request.taskPath,
        }),
      };
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
      const report = await runEvaluation({
        announceBudget: false,
        config: { ...DEFAULT_CONFIG, pricing },
        reportTimestamp: "2026-08-29T00:00:00.000Z",
        runner,
        screeningReportPath: paths.json,
        writeReportOutput: false,
      });
      expect(report.status).toBe("UNAVAILABLE");
      expect(report.metrics).toMatchObject({
        dominance: {
          reweighted: {
            status: "unavailable",
            verdict: "UNAVAILABLE",
          },
        },
      });
      expect(report.metrics.q2).toMatchObject({
        taskLevel: {
          all: {
            executorFailAdvisorPass: 1,
            executorPassAdvisorFail: 0,
          },
        },
      });
      expect(report.metrics.plots).toMatchObject({
        reweighted: expect.stringContaining("<svg"),
        uplift: expect.stringContaining("<svg"),
      });
      const { strata } = report.metrics as unknown as {
        strata: {
          outOfReach: { arm: string; costPerTask: unknown }[];
          uplift: {
            arm: string;
            costPerTask: unknown;
            passRate: number;
            taskCount: number;
          }[];
        };
      };
      expect(
        strata.outOfReach.some(
          (point) => point.arm === "E+A" && point.costPerTask === "unavailable"
        )
      ).toBe(true);
      expect(strata.uplift).toContainEqual({
        arm: "F",
        costPerTask: 0.5,
        passRate: 1,
        taskCount: 1,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
