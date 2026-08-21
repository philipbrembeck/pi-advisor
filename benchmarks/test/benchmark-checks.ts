import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { canonicalRuntime } from "../src/audit.js";
import {
  modePolicy,
  resolveModeModels,
  validateBenchmarkConfig,
} from "../src/config.js";
import { createIsolatedAttempt, summarizeWorkspace } from "../src/isolation.js";
import { runBenchmark } from "../src/orchestrator.js";
import { activeToolsForMode } from "../src/profile.js";
import { buildReport } from "../src/report.js";
import { bootstrap, isSuccessful, median } from "../src/statistics.js";
import { discoverTasks } from "../src/task-loader.js";
import { configuredCost, normalizeUsage } from "../src/usage.js";
import { runValidator } from "../src/validation.js";

describe("benchmark contracts", () => {
  test("canonicalizes only ephemeral runtime identities", () => {
    const runtime = {
      effectiveSystemPrompt: "/tmp/pi-benchmark-abc/workspace",
      effectiveSystemPromptHash: "hash",
      environmentVariables: { PI_CODING_AGENT_DIR: "/tmp/pi-benchmark-abc" },
    } as never;
    const canonical = canonicalRuntime(runtime);
    expect(canonical.effectiveSystemPrompt).toContain("pi-benchmark-<run>");
    expect(canonical.effectiveSystemPromptHash).toBe(
      "<derived-from-canonical-prompt>"
    );
    expect(canonical.environmentVariables.PI_CODING_AGENT_DIR).toBe(
      "/tmp/pi-benchmark-<run>"
    );
  });

  test("validates modes without hardcoded provider models", () => {
    const config = {
      execution: {
        agentRetries: 0,
        compactionEnabled: false,
        runs: 5,
        seed: 1,
        timeoutSeconds: 10,
        tools: ["read"],
      },
      models: { frontier: { ref: "a/frontier" }, small: { ref: "b/small" } },
      output: {
        reportJsonPath: "z",
        reportMarkdownPath: "y",
        resultsPath: "x",
      },
      pricing: {
        "a/frontier": {
          cacheReadPerMillion: 3,
          cacheWritePerMillion: 4,
          inputPerMillion: 1,
          outputPerMillion: 2,
        },
        "b/small": {
          cacheReadPerMillion: 0,
          cacheWritePerMillion: 0,
          inputPerMillion: 0,
          outputPerMillion: 0,
        },
      },
    };
    expect(() => validateBenchmarkConfig(config)).not.toThrow();
    expect(resolveModeModels(config, "advisor-scout")).toEqual({
      advisor: "a/frontier",
      executor: "b/small",
      scout: "b/small",
    });
  });

  test("activates only the intended Advisor tool by mode", () => {
    const tools = ["read", "bash", "edit", "write"];
    expect(activeToolsForMode("baseline", tools)).toEqual(tools);
    expect(activeToolsForMode("small-baseline", tools)).toEqual(tools);
    expect(activeToolsForMode("advisor", tools)).toEqual([
      ...tools,
      "ask_advisor",
    ]);
    expect(activeToolsForMode("advisor-scout", tools)).toEqual([
      ...tools,
      "ask_advisor",
    ]);
  });

  test("keeps experimental mode semantics explicit", () => {
    expect(modePolicy("luna")).toMatchObject({
      advisorCallPolicy: "none",
      advisorToolAvailable: false,
      scoutAvailable: false,
    });
    expect(modePolicy("luna-advisor-optional")).toMatchObject({
      advisorCallPolicy: "optional",
      advisorToolAvailable: true,
      scoutAvailable: false,
    });
    expect(modePolicy("luna-advisor-mandatory")).toMatchObject({
      advisorCallPolicy: "mandatory",
      advisorToolAvailable: true,
      scoutAvailable: false,
    });
    expect(modePolicy("luna-advisor-scout")).toMatchObject({
      advisorCallPolicy: "mandatory",
      advisorToolAvailable: true,
      scoutAvailable: true,
    });
    expect(modePolicy("advisor-guidance").advisorTrustPolicy).toBe("guidance");
  });

  test("classifies validator invariants without exposing them during execution", async () => {
    const result = await runValidator(
      "-e",
      [
        'process.stderr.write("invariant:wrong-error-contract\\n"); process.exit(1)',
      ],
      process.cwd(),
      2
    );
    expect(result).toMatchObject({
      failureClass: "validation-failure",
      invariant: "wrong-error-contract",
      passed: false,
    });
    expect(result.failureReason).toContain("wrong-error-contract");
  });

  test("keeps missing provider usage unknown and prices full token fields", () => {
    expect(normalizeUsage({ input: 2, output: 3 })).toMatchObject({
      input: 2,
      output: 3,
      usageAvailable: false,
    });
    expect(
      configuredCost(
        {
          cacheRead: 3_000_000,
          cacheWrite: 4_000_000,
          input: 1_000_000,
          output: 2_000_000,
          totalTokens: 10_000_000,
          usageAvailable: true,
        },
        {
          cacheReadPerMillion: 3,
          cacheWritePerMillion: 4,
          inputPerMillion: 1,
          outputPerMillion: 2,
        }
      )
    ).toBe(30);
  });

  test("provides deterministic statistics", () => {
    expect(median([3, 1, 2, 4])).toBe(2.5);
    const interval = bootstrap([0, 1, 1, 0], 42, 100);
    expect(interval.low).not.toBeNull();
    expect(interval.high).not.toBeNull();
  });

  test("does not count a timed-out validation as a success", () => {
    const record = {
      correct: true,
      termination: { state: "timeout" },
      validation: { passed: true, timedOut: false },
    } as never;
    expect(isSuccessful(record)).toBe(false);
  });

  test("discovers the complete balanced task suite", () => {
    const tasks = discoverTasks("benchmarks/tasks");
    expect(tasks).toHaveLength(20);
    expect(new Set(tasks.map((task) => task.category))).toEqual(
      new Set(["implementation", "debugging", "reasoning", "recovery"])
    );
    for (const category of [
      "implementation",
      "debugging",
      "reasoning",
      "recovery",
    ] as const) {
      expect(tasks.filter((task) => task.category === category)).toHaveLength(
        5
      );
    }
    expect(tasks.every((task) => task.metadata?.difficulty !== "easy")).toBe(
      true
    );
    expect(
      tasks.some(
        (task) =>
          task.metadata?.contextProfile === "26 source files / distractor-heavy"
      )
    ).toBe(true);
  });

  test("trajectory prototype has exactly three realistic tasks", () => {
    const tasks = discoverTasks("benchmarks/trajectory");
    expect(tasks).toHaveLength(3);
    expect(new Set(tasks.map((task) => task.category))).toEqual(
      new Set(["debugging", "recovery", "reasoning"])
    );
    expect(tasks.every((task) => task.metadata?.shape)).toBe(true);
    expect(tasks.every((task) => task.fixtureHash.startsWith("sha256:"))).toBe(
      true
    );
  });

  test("trajectory fixtures fail their hidden validators before repair", () => {
    const tasks = discoverTasks("benchmarks/trajectory");
    for (const task of tasks) {
      const result = spawnSync(process.execPath, [task.validatorPath], {
        cwd: task.fixturePath,
        encoding: "utf8",
        timeout: 5000,
      });
      expect(result.status, task.id).not.toBe(0);
    }
  });

  test("isolated workspaces do not expose golden answers", async () => {
    const [task] = discoverTasks("benchmarks/tasks");
    const attempt = await createIsolatedAttempt(task, "{}");
    try {
      expect(existsSync(join(attempt.workspace, "benchmarks", "golden"))).toBe(
        false
      );
      expect(existsSync(join(attempt.workspace, "golden"))).toBe(false);
    } finally {
      attempt.cleanup();
    }
  });

  test("workspace metrics include nested untracked and renamed paths", async () => {
    const [task] = discoverTasks("benchmarks/trajectory");
    const attempt = await createIsolatedAttempt(task, "{}");
    try {
      mkdirSync(join(attempt.workspace, "nested dir"));
      writeFileSync(
        join(attempt.workspace, "nested dir", "file name.txt"),
        "new"
      );
      renameSync(
        join(attempt.workspace, "src", "errors.js"),
        join(attempt.workspace, "src", "renamed errors.js")
      );
      execFileSync("git", ["add", "-A"], { cwd: attempt.workspace });
      const summary = await summarizeWorkspace(
        attempt.workspace,
        attempt.initialGitCommit
      );
      expect(
        summary.changedPaths.some((path) => path.includes("file name"))
      ).toBe(true);
      expect(summary.changedPaths.some((path) => path.includes(" -> "))).toBe(
        true
      );
      expect(summary.diffBytes).toBeGreaterThan(0);
    } finally {
      attempt.cleanup();
    }
  });

  test("paired report counts rescues, regressions, and Scout transitions", () => {
    const base = (
      mode: "baseline" | "small-baseline" | "advisor" | "advisor-scout",
      correct: boolean
    ) => ({
      advisor: {
        cacheRead: 0,
        cacheWrite: 0,
        calls: 0,
        configuredCost: 0,
        input: 0,
        invocationStatus: "inactive" as const,
        model: "inactive",
        output: 0,
        providerCost: 0,
        role: "advisor" as const,
        totalTokens: 0,
        usageAvailable: true,
      },
      agentDurationMs: 1,
      category: "debugging" as const,
      correct,
      createdAt: new Date().toISOString(),
      durationMs: 1,
      executor: {
        cacheRead: 0,
        cacheWrite: 0,
        calls: 1,
        configuredCost: 1,
        input: 1,
        invocationStatus: "observed" as const,
        model: "small",
        output: 1,
        providerCost: 1,
        role: "executor" as const,
        totalTokens: 2,
        usageAvailable: true,
      },
      failureClass: correct
        ? ("success" as const)
        : ("validation-failure" as const),
      mode,
      modelIds: {
        requested: { advisor: null, executor: "small", scout: null },
        resolved: { advisor: null, executor: "small", scout: null },
      },
      profile: { agentRetries: 0, compactionEnabled: false, tools: [] },
      provenance: {
        benchmarkConfigHash: "x",
        fixtureHash: "x",
        profileHash: "x",
        schemaVersion: 1 as const,
        systemPromptHash: "x",
        taskHash: "x",
      },
      repetition: 0,
      runId: `${mode}-0`,
      runKey: `${mode}-0`,
      schemaVersion: 1 as const,
      scout: {
        cacheRead: 0,
        cacheWrite: 0,
        calls: 0,
        configuredCost: 0,
        input: 0,
        invocationStatus: "inactive" as const,
        model: "inactive",
        output: 0,
        providerCost: 0,
        role: "scout" as const,
        totalTokens: 0,
        usageAvailable: true,
      },
      seed: 1,
      setupDurationMs: 0,
      taskId: "pair",
      termination: { sessionSettled: true, state: "settled" as const },
      totalCost: 1,
      validation: {
        durationMs: 0,
        exitCode: correct ? 0 : 1,
        failureClass: correct
          ? ("success" as const)
          : ("validation-failure" as const),
        passed: correct,
        stderrSummary: "",
        stdoutSummary: "",
        timedOut: false,
      },
      validationDurationMs: 0,
      workspace: {
        added: 0,
        changedPaths: [],
        deleted: 0,
        diffBytes: 0,
        modified: 0,
      },
    });
    const records = [
      base("baseline", false),
      base("small-baseline", false),
      base("advisor", true),
      base("advisor-scout", false),
    ];
    const report = buildReport(records, "synthetic.jsonl", 1, 1);
    expect(report.comparisons.outcomeIntersection.advisorRescue).toBe(1);
    expect(report.comparisons.outcomeIntersection.advisorRegression).toBe(0);
    expect(report.comparisons.scoutTransitions.advisorPassScoutFail).toBe(1);

    const mismatched = [
      ...records,
      base("small-baseline", false),
      { ...base("advisor", true), experimentHash: "different-experiment" },
    ];
    const mismatchedReport = buildReport(mismatched, "synthetic.jsonl", 1, 1);
    expect(mismatchedReport.comparisons.outcomeIntersection.advisorRescue).toBe(
      1
    );
  });

  test("mock smoke run writes exactly 12 append-friendly records", async () => {
    const root = mkdtempSync(join(process.cwd(), "benchmarks-test-"));
    const results = join(root, "runs.jsonl");
    try {
      const run = await runBenchmark({
        concurrency: 3,
        configPath: "benchmarks/config/benchmark.example.json",
        mock: true,
        resultsPath: results,
        runs: 1,
        seed: 7,
        taskIds: ["implementation-01", "debugging-01", "recovery-01"],
        tasksPath: "benchmarks/tasks",
      });
      expect(run.records).toHaveLength(12);
      expect(readFileSync(results, "utf8").trim().split("\n")).toHaveLength(12);
      expect(new Set(run.records.map((record) => record.runId)).size).toBe(12);
      const resumed = await runBenchmark({
        concurrency: 3,
        configPath: "benchmarks/config/benchmark.example.json",
        mock: true,
        resultsPath: results,
        runs: 1,
        seed: 7,
        taskIds: ["implementation-01", "debugging-01", "recovery-01"],
        tasksPath: "benchmarks/tasks",
      });
      expect(resumed.records).toHaveLength(0);
      expect(readFileSync(results, "utf8").trim().split("\n")).toHaveLength(12);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 10_000);
});
