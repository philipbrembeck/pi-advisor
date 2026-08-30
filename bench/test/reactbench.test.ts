import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CommandReactBenchRunner,
  parseReactBenchResult,
} from "../src/reactbench.js";

describe("ReactBench adapter boundary", () => {
  test("requires structured results and validates provider pins", async () => {
    const root = mkdtempSync(
      join(process.env.TMPDIR ?? "/tmp", "bench-adapter-")
    );
    try {
      const script = join(root, "adapter.mjs");
      writeFileSync(
        script,
        `console.log("BENCH_RESULT=" + JSON.stringify({passed:true, cost:0, consultations:0, requests:[{provider:"openai-codex", model:"gpt-5.6-luna", effort:"max", role:"executor"}]}));\n`
      );
      chmodSync(script, 0o755);
      const runner = new CommandReactBenchRunner({
        artifactRoot: root,
        command: process.execPath,
        extraArgs: [script],
      });
      const result = await runner.run({
        arm: "E",
        artifactRoot: root,
        executor: {
          effort: "max",
          model: "openai-codex/gpt-5.6-luna",
          role: "executor",
        },
        seed: 11,
        taskPath: "task",
      });
      expect(result.passed).toBe(true);
      expect(result.requests).toHaveLength(1);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("rejects malformed adapter output", () => {
    expect(() => parseReactBenchResult("BENCH_RESULT={}", "task")).toThrow(
      "boolean passed"
    );
  });
});
