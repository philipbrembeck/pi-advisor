import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type {
  ReactBenchTrialRequest,
  ReactBenchTrialResult,
} from "../src/reactbench.ts";
import { runScreening } from "../src/screen.ts";

describe("Stage 1 screening", () => {
  test("classifies every task and selects a seeded trivial stratum", async () => {
    const root = mkdtempSync(
      join(process.env.TMPDIR ?? "/tmp", "bench-screen-")
    );
    try {
      for (let index = 0; index < 30; index += 1) {
        const task = join(root, `task-${String(index).padStart(2, "0")}`);
        mkdirSync(task, { recursive: true });
        writeFileSync(
          `${task}/task.toml`,
          `tags = ["${index % 2 ? "write-react" : "fix-react"}"]\n`
        );
      }
      const trialBudgets: number[] = [];
      const runner = {
        run: (
          request: ReactBenchTrialRequest
        ): Promise<ReactBenchTrialResult> => {
          if (request.budgetUsd !== undefined) {
            trialBudgets.push(request.budgetUsd);
          }
          return Promise.resolve({
            consultations: 0,
            cost: 0,
            passed:
              request.arm === "F"
                ? request.taskPath.endsWith("00") ||
                  request.taskPath.endsWith("01")
                : !request.taskPath.endsWith("00"),
            taskId: request.taskPath,
          });
        },
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
      const report = await runScreening({
        announceBudget: false,
        config: { ...DEFAULT_CONFIG, pricing },
        reportTimestamp: "2026-08-29T00:00:00.000Z",
        runner,
        sourceRoot: root,
        writeReportOutput: false,
      });
      expect(report.status).toBe("PASS");
      expect(report.metrics.tasks).toHaveLength(30);
      expect(report.metrics.candidateBandPrevalence).toBeGreaterThan(0);
      expect(report.metrics.trivialStratumTaskIds).toHaveLength(3);
      expect(report.metrics.screeningSeeds).toEqual([11, 23]);
      expect(trialBudgets).toHaveLength(120);
      expect(
        trialBudgets.every(
          (value) => value > 0 && value <= DEFAULT_CONFIG.budgetUsd
        )
      ).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("rejects the smoke protocol at the screening entrypoint", async () => {
    const previous = process.env.BENCH_SMOKE;
    process.env.BENCH_SMOKE = "1";
    try {
      await expect(
        runScreening({ announceBudget: false, writeReportOutput: false })
      ).rejects.toThrow("reserved for the dedicated Harbor smoke invocation");
    } finally {
      if (previous === undefined) {
        delete process.env.BENCH_SMOKE;
      } else {
        process.env.BENCH_SMOKE = previous;
      }
    }
  });
});
