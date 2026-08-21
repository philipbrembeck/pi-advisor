import { describe, expect, test } from "bun:test";
import { loadManifest } from "../swebench/adapter.js";
import { createReplicationSchedule } from "../swebench/optional-advisor-replication.js";
import { exactPairedP } from "../swebench/optional-advisor-replication-report.js";

const manifest = loadManifest(
  "benchmarks/swebench/hard-baseline-v2-manifest.json"
);

describe("optional Advisor replication design", () => {
  test("creates 60 sequential randomized pairs and 120 unique cells", () => {
    const pairs = createReplicationSchedule(manifest);
    const entries = pairs.flatMap((pair) => pair.entries);
    expect(pairs).toHaveLength(60);
    expect(entries).toHaveLength(120);
    expect(new Set(pairs.map((pair) => pair.pairId)).size).toBe(60);
    expect(
      new Set(
        entries.map(
          (entry) => `${entry.taskId}/${entry.mode}/${entry.repetition}`
        )
      ).size
    ).toBe(120);
    expect(
      pairs.every(
        (pair) =>
          pair.entries[0].taskId === pair.entries[1].taskId &&
          pair.entries[0].repetition === pair.entries[1].repetition &&
          pair.entries[0].mode !== pair.entries[1].mode &&
          pair.entries[0].withinPairOrder === 0 &&
          pair.entries[1].withinPairOrder === 1
      )
    ).toBe(true);
  });

  test("computes exact two-sided paired p-values", () => {
    expect(exactPairedP(0, 0)).toBe(1);
    expect(exactPairedP(0, 4)).toBe(0.125);
    expect(exactPairedP(4, 0)).toBe(0.125);
  });
});
