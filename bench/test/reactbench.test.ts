import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildReactBenchArgs,
  CommandReactBenchRunner,
  parseReactBenchResult,
} from "../src/reactbench.js";

describe("ReactBench adapter boundary", () => {
  test("forwards seed, arm, pins, and pricing as structured arguments", () => {
    const args = buildReactBenchArgs({
      advisor: {
        effort: "medium",
        model: "openai-codex/gpt-5.6-sol",
        role: "advisor",
      },
      arm: "E+A",
      artifactRoot: "/tmp/artifacts",
      budgetUsd: 3,
      executor: {
        effort: "max",
        model: "openai-codex/gpt-5.6-luna",
        role: "executor",
      },
      pricing: {
        executor: {
          cacheReadPerMillion: 1,
          cacheWritePerMillion: 2,
          inputPerMillion: 3,
          outputPerMillion: 4,
        },
      },
      seed: 113,
      taskPath: "/tmp/task",
    });
    expect(args).toEqual([
      "--budget-usd",
      "3",
      "--task",
      "/tmp/task",
      "--seed",
      "113",
      "--arm",
      "E+A",
      "--executor-model",
      "openai-codex/gpt-5.6-luna",
      "--executor-effort",
      "max",
      "--artifact-root",
      "/tmp/artifacts",
      "--pricing-json",
      JSON.stringify({
        executor: {
          cacheReadPerMillion: 1,
          cacheWritePerMillion: 2,
          inputPerMillion: 3,
          outputPerMillion: 4,
        },
      }),
      "--advisor-model",
      "openai-codex/gpt-5.6-sol",
      "--advisor-effort",
      "medium",
    ]);
  });

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

  test("preserves a separate Advisor attestation record", () => {
    const result = parseReactBenchResult(
      [
        `BENCH_ADVISOR_ATTESTATION=${JSON.stringify({ loaded: true })}`,
        'BENCH_RESULT={"passed":true,"requests":[{"role":"executor"}]}',
      ].join("\n"),
      "task"
    );
    expect(result.attestation).toEqual({ loaded: true });
  });

  test("rejects malformed adapter output", () => {
    expect(() => parseReactBenchResult("BENCH_RESULT={}", "task")).toThrow(
      "boolean passed"
    );
    expect(() =>
      parseReactBenchResult('BENCH_RESULT={"passed":true}', "task")
    ).toThrow("provider request object array");
  });

  test("surfaces command failures and timeouts", async () => {
    const root = mkdtempSync(
      join(process.env.TMPDIR ?? "/tmp", "bench-adapter-failure-")
    );
    const request = {
      arm: "E" as const,
      artifactRoot: root,
      executor: {
        effort: "max",
        model: "openai-codex/gpt-5.6-luna",
        role: "executor" as const,
      },
      seed: 11,
      taskPath: "task",
    };
    try {
      const failing = join(root, "failing.mjs");
      writeFileSync(failing, "process.exit(7);\n");
      await expect(
        new CommandReactBenchRunner({
          artifactRoot: root,
          command: process.execPath,
          extraArgs: [failing],
        }).run(request)
      ).rejects.toThrow();

      const hanging = join(root, "hanging.mjs");
      writeFileSync(hanging, "setTimeout(() => {}, 1000);\n");
      await expect(
        new CommandReactBenchRunner({
          artifactRoot: root,
          command: process.execPath,
          extraArgs: [hanging],
          timeoutMs: 25,
        }).run(request)
      ).rejects.toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
