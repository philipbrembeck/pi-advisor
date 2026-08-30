import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadDecisionItem } from "../src/fixture.js";
import {
  compareDiscrimination,
  harvestTrajectory,
  reharvestNotice,
  writeHarvestedItem,
} from "../src/harvest.js";

const trajectory = {
  answer: {
    defectClass: "observed-defect",
    findingId: "react-doctor/observed-defect",
    reasonTokens: ["specific", "risk"],
    targetFile: "src/App.tsx",
    targetSymbol: "App",
  },
  band: "candidate-uplift" as const,
  conversation: "A real screened conversation.",
  draft: "# Failing Executor draft\n",
  polarity: "positive" as const,
  repoPath: "/tmp/repo",
  sourceRun: "screen-run-1",
  sourceSeed: 101,
  taskId: "task-1",
  traps: [],
};

describe("trajectory harvest", () => {
  test("writes a provenance-linked item without repository content", () => {
    const root = mkdtempSync(
      join(process.env.TMPDIR ?? "/tmp", "bench-harvest-")
    );
    try {
      const path = writeHarvestedItem(root, trajectory, "reactbench-sha");
      const item = loadDecisionItem(path);
      expect(item.id).toBe("harvested-task-1-101");
      expect(item.band).toBe("candidate-uplift");
      expect(readFileSync(join(path, "repo", ".gitkeep"), "utf8")).toBe("");
      expect(readFileSync(join(path, "item.toml"), "utf8")).toContain(
        "screen-run-1"
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("enforces the source stratum for each polarity", () => {
    expect(() => harvestTrajectory({ ...trajectory, band: "trivial" })).toThrow(
      "candidate-uplift"
    );
    expect(
      harvestTrajectory({ ...trajectory, band: "candidate-uplift" }).taskId
    ).toBe("task-1");
  });

  test("compares discrimination and records a re-harvest date", () => {
    const discrimination = compareDiscrimination({
      frontierCatchRate: 0.8,
      harvested: true,
      nullCatchRate: 0.1,
      oracleCatchRate: 1,
    });
    expect(discrimination.frontierNullCatchSpread).toBeCloseTo(0.7);
    expect(discrimination.frontierOracleCatchSpread).toBeCloseTo(0.2);
    expect(discrimination.harvested).toBe(true);
    expect(reharvestNotice("2027-01-01")).toContain("2027-01-01");
  });
});
