/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: orchestration explicitly preserves every failure boundary. */
/* biome-ignore-all lint/suspicious/noBitwiseOperators: the seeded PRNG uses a fixed 32-bit recurrence for replayability. */
/* biome-ignore-all lint/performance/noAwaitInLoops: attempts are intentionally serialized to preserve seeded scheduling and provider-load accounting. */
/* biome-ignore-all lint/style/noNonNullAssertion: records are appended immediately before these guarded updates. */
/* biome-ignore-all lint/style/useDestructuring: options remain explicit at the orchestration boundary. */
/* biome-ignore-all lint/suspicious/noUnnecessaryConditions: CLI option fallbacks are intentionally explicit. */
/* biome-ignore-all lint/style/noNestedTernary: failure states are mutually exclusive and kept at the orchestration boundary. */
/* biome-ignore-all assist/source/useSortedKeys: persisted benchmark records are schema-shaped rather than alphabetized. */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  defaultModes,
  loadBenchmarkConfig,
  modePolicy,
  resolveModeModels,
} from "./config.js";
import { createIsolatedAttempt, hashJson } from "./isolation.js";
import { activeToolsForMode } from "./profile.js";
import { discoverTasks, selectTasks } from "./task-loader.js";
import type {
  BenchmarkCategory,
  BenchmarkConfig,
  BenchmarkMode,
  RawBenchmarkResult,
  ResolvedTask,
  RunSpec,
} from "./types.js";
import {
  BENCHMARK_HARNESS_VERSION,
  BENCHMARK_SCHEMA_VERSION,
} from "./types.js";
import { unknownUsage, zeroUsage } from "./usage.js";
import { runValidator } from "./validation.js";

const PROVIDER_FAILURE_PATTERN =
  /provider|rate limit|429|authentication|quota/i;

const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
};
export interface RunOptions {
  category?: BenchmarkCategory;
  concurrency?: number;
  configPath: string;
  mock?: boolean;
  modes?: BenchmarkMode[];
  progressIntervalSeconds?: number;
  resultsPath?: string;
  runs?: number;
  seed?: number;
  taskIds?: string[];
  tasksPath: string;
}

const readResumableResults = (path: string): RawBenchmarkResult[] => {
  if (!existsSync(path)) {
    return [];
  }
  const lines = readFileSync(path, "utf8").split("\n");
  const records: RawBenchmarkResult[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    try {
      records.push(JSON.parse(line) as RawBenchmarkResult);
    } catch (error) {
      if (index !== lines.length - 1) {
        throw new Error(
          `Results file is corrupt on line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error }
        );
      }
      // A process can be killed during a final append. Preserve complete
      // records and truncate only the incomplete trailing record.
      writeFileSync(
        path,
        `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
      );
    }
  }
  return records;
};

const schedule = (
  tasks: ResolvedTask[],
  modes: BenchmarkMode[],
  runs: number,
  seed: number
) => {
  const entries = tasks.flatMap((task) =>
    modes.flatMap((mode) =>
      Array.from({ length: runs }, (_, repetition) => ({
        mode,
        repetition,
        task,
      }))
    )
  );
  const random = seededRandom(seed);
  for (let i = entries.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  return entries;
};

const mockResult = (
  task: ResolvedTask,
  mode: BenchmarkMode,
  repetition: number,
  seed: number,
  config: BenchmarkConfig,
  runId: string,
  runKey: string,
  benchmarkConfigHash: string
): RawBenchmarkResult => {
  const policy = modePolicy(mode);
  const advisorUsed = policy.advisorCallPolicy === "mandatory";
  const assisted = advisorUsed || policy.scoutAvailable;
  const correct = !(
    assisted &&
    task.category === "recovery" &&
    repetition % 2 === 0
  );
  const executor = {
    cacheRead: 0,
    cacheWrite: 0,
    calls: 1,
    configuredCost: 0.001,
    input: 100,
    invocationStatus: "observed" as const,
    model: resolveModeModels(config, mode).executor,
    output: 20,
    providerCost: 0.001,
    requestedRef: resolveModeModels(config, mode).executor,
    role: "executor" as const,
    totalTokens: 120,
    usageAvailable: true,
  };
  const advisor = advisorUsed
    ? {
        cacheRead: 0,
        cacheWrite: 0,
        calls: 1,
        configuredCost: 0.001,
        input: 30,
        invocationStatus: "observed" as const,
        model: config.models.frontier.ref,
        output: 10,
        providerCost: 0.001,
        requestedRef: config.models.frontier.ref,
        role: "advisor" as const,
        totalTokens: 40,
        usageAvailable: true,
      }
    : {
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
      };
  const scout = policy.scoutAvailable
    ? {
        cacheRead: 0,
        cacheWrite: 0,
        calls: 1,
        configuredCost: 0.001,
        input: 20,
        invocationStatus: "observed" as const,
        model: config.models.small.ref,
        output: 5,
        providerCost: 0.001,
        requestedRef: config.models.small.ref,
        role: "scout" as const,
        totalTokens: 25,
        usageAvailable: true,
      }
    : {
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
      };
  return {
    advisor,
    agentDurationMs: 80,
    category: task.category,
    correct,
    createdAt: new Date().toISOString(),
    durationMs: 100 + repetition,
    executor,
    experimentHash: benchmarkConfigHash,
    failureClass: correct ? "success" : "validation-failure",
    mode,
    modelIds: {
      requested: {
        advisor: assisted ? advisor.model : null,
        executor: executor.model,
        scout: policy.scoutAvailable ? scout.model : null,
      },
      resolved: {
        advisor: assisted ? advisor.model : null,
        executor: executor.model,
        scout: policy.scoutAvailable ? scout.model : null,
      },
    },
    profile: {
      agentRetries: config.execution.agentRetries,
      compactionEnabled: config.execution.compactionEnabled,
      tools: activeToolsForMode(mode, config.execution.tools),
    },
    provenance: {
      benchmarkConfigHash,
      fixtureHash: task.fixtureHash,
      harnessVersion: BENCHMARK_HARNESS_VERSION,
      profileHash: hashJson(config.execution),
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      systemPromptHash: hashJson("mock-system"),
      taskHash: task.taskHash,
      validatorHash: task.validatorHash,
    },
    repetition,
    runId,
    runKey,
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    scout,
    seed,
    setupDurationMs: 1,
    taskId: task.id,
    trajectory: {
      agentTurns: 1,
      changedFiles: 1,
      edits: 1,
      failedValidationCycles: correct ? 0 : 1,
      fileReads: 4,
      modelCalls: executor.calls + advisor.calls + scout.calls,
      testExecutions: 1,
      toolCalls: 6,
    },
    termination: { sessionSettled: true, state: "settled" },
    totalCost:
      (executor.configuredCost ?? 0) +
      (advisor.configuredCost ?? 0) +
      (scout.configuredCost ?? 0),
    validation: {
      durationMs: 19,
      exitCode: correct ? 0 : 1,
      failureClass: correct ? "success" : "validation-failure",
      failureReason: correct ? undefined : "mock validator failure",
      passed: correct,
      stderrSummary: "",
      stdoutSummary: "mock",
      timedOut: false,
    },
    validationDurationMs: 19,
    workspace: {
      added: 0,
      changedPaths: ["src/index.ts"],
      deleted: 0,
      diffBytes: 12,
      modified: 1,
    },
  };
};

const runChild = (
  spec: RunSpec,
  timeoutMs: number
): Promise<{
  result?: RawBenchmarkResult;
  telemetry?: unknown[];
  error?: string;
}> =>
  new Promise((resolveResult) => {
    const child = spawn(
      process.execPath,
      [new URL("./worker.ts", import.meta.url).pathname],
      {
        cwd: resolve("."),
        detached: true,
        env: { ...process.env, PI_CODING_AGENT_DIR: spec.agentDir },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const killTree = (signal: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The process may have exited between the timeout and group kill.
        }
      }
      child.kill(signal);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 500).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveResult({ error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return resolveResult({
          error: `worker timed out after ${timeoutMs}ms`,
        });
      }
      if (code !== 0) {
        return resolveResult({
          error: stderr.slice(-2000) || `worker exited ${code}`,
        });
      }
      try {
        const payload = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
        resolveResult(payload);
      } catch (error) {
        resolveResult({
          error: `malformed worker output: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
    child.stdin.end(JSON.stringify(spec));
  });

const infrastructureResult = (
  task: ResolvedTask,
  mode: BenchmarkMode,
  repetition: number,
  seed: number,
  config: BenchmarkConfig,
  runId: string,
  runKey: string,
  benchmarkConfigHash: string,
  error: string
): RawBenchmarkResult => {
  const models = resolveModeModels(config, mode);
  const result = mockResult(
    task,
    mode,
    repetition,
    seed,
    config,
    runId,
    runKey,
    benchmarkConfigHash
  );
  result.correct = false;
  result.advisor = models.advisor
    ? unknownUsage("advisor", models.advisor)
    : zeroUsage("advisor", "inactive");
  result.executor = unknownUsage("executor", models.executor);
  result.scout = models.scout
    ? unknownUsage("scout", models.scout)
    : zeroUsage("scout", "inactive");
  result.durationMs = 0;
  result.totalCost = null;
  result.infrastructureFailure = error;
  result.failureClass = error.includes("timed out")
    ? "agent-timeout"
    : PROVIDER_FAILURE_PATTERN.test(error)
      ? "provider-failure"
      : "infrastructure-failure";
  result.termination = {
    error,
    sessionSettled: false,
    state:
      result.failureClass === "agent-timeout"
        ? "timeout"
        : result.failureClass === "provider-failure"
          ? "provider-error"
          : "worker-error",
  };
  result.validation = {
    durationMs: 0,
    exitCode: null,
    failureReason: "worker did not produce a result",
    passed: false,
    stderrSummary: error.slice(-2000),
    stdoutSummary: "",
    timedOut: false,
  };
  return result;
};

export const runBenchmark = async (options: RunOptions) => {
  const loaded = loadBenchmarkConfig(options.configPath);
  const config = loaded.config;
  const tasks = selectTasks(discoverTasks(options.tasksPath), {
    category: options.category,
    ids: options.taskIds,
  });
  if (tasks.length === 0) {
    throw new Error("No benchmark tasks matched the requested filters.");
  }
  const modes = options.modes?.length ? options.modes : defaultModes();
  const runs = options.runs ?? config.execution.runs;
  if (!Number.isSafeInteger(runs) || runs <= 0) {
    throw new Error("runs must be a positive integer.");
  }
  const progressIntervalSeconds = options.progressIntervalSeconds ?? 30;
  if (
    !Number.isFinite(progressIntervalSeconds) ||
    progressIntervalSeconds <= 0
  ) {
    throw new Error("progress interval must be a positive number of seconds.");
  }
  const seed = options.seed ?? config.execution.seed;
  const path = resolve(options.resultsPath ?? config.output.resultsPath);
  mkdirSync(dirname(path), { recursive: true });
  const experimentHash = hashJson({
    config,
    configFileHash: loaded.hash,
    harnessVersion: BENCHMARK_HARNESS_VERSION,
    mock: Boolean(options.mock),
    modes,
    runs,
    seed,
    tasks: tasks.map((task) => ({
      fixtureHash: task.fixtureHash,
      id: task.id,
      taskHash: task.taskHash,
      validatorHash: task.validatorHash,
    })),
  });
  const runKey = (entry: {
    mode: BenchmarkMode;
    repetition: number;
    task: ResolvedTask;
  }) =>
    hashJson({
      benchmarkConfigHash: experimentHash,
      mode: entry.mode,
      repetition: entry.repetition,
      taskId: entry.task.id,
    });
  const entries = schedule(tasks, modes, runs, seed).map((entry) => ({
    ...entry,
    runKey: runKey(entry),
  }));
  const existing = readResumableResults(path);
  const incompatible = existing.find(
    (record) =>
      record.runKey &&
      record.provenance.benchmarkConfigHash !== experimentHash &&
      record.provenance.benchmarkConfigHash !== loaded.hash
  );
  if (incompatible) {
    throw new Error(
      `Results file contains an incompatible benchmark configuration (${incompatible.taskId}/${incompatible.mode}/${incompatible.repetition}). Use a new --results path.`
    );
  }
  const completedKeys = new Set(
    existing
      .filter(
        (record) =>
          record.provenance.benchmarkConfigHash === experimentHash ||
          record.provenance.benchmarkConfigHash === loaded.hash
      )
      .map((record) => record.runKey)
      .filter((key): key is string => Boolean(key))
  );
  const pending = entries.filter((entry) => !completedKeys.has(entry.runKey));
  const records: RawBenchmarkResult[] = [];
  const concurrency = options.concurrency ?? 1;
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error("concurrency must be a positive integer.");
  }
  let finished = entries.length - pending.length;
  const progressTimer = setInterval(() => {
    process.stdout.write(
      `[benchmark-progress] completed=${finished}/${entries.length} pending=${entries.length - finished}\n`
    );
  }, progressIntervalSeconds * 1000);
  progressTimer.unref?.();
  process.stdout.write(
    `[benchmark-progress] started total=${entries.length} pending=${pending.length} concurrency=${concurrency}\n`
  );

  const runEntry = async (entry: (typeof pending)[number]) => {
    const models = resolveModeModels(config, entry.mode);
    const policy = modePolicy(entry.mode);
    const advisorConfig = {
      executor: models.executor,
      ...(models.advisor ? { advisor: models.advisor } : {}),
      advisorAutoLoopGate: false,
      advisorCompletionGate: policy.advisorCallPolicy === "mandatory",
      advisorFailureGate: false,
      advisorGitContext: "off",
      advisorMaxCallsPerSession: 4,
      advisorPlanGate: policy.advisorCallPolicy === "mandatory",
      advisorRedactSecrets: true,
      advisorScoutEnabled: policy.scoutAvailable,
      advisorSessionSummary: false,
      alwaysOn: policy.advisorCallPolicy === "mandatory",
    };
    let attempt: Awaited<ReturnType<typeof createIsolatedAttempt>>;
    try {
      attempt = await createIsolatedAttempt(
        entry.task,
        JSON.stringify(advisorConfig)
      );
    } catch (error) {
      const record = infrastructureResult(
        entry.task,
        entry.mode,
        entry.repetition,
        seed,
        config,
        randomUUID(),
        entry.runKey,
        experimentHash,
        `setup failed: ${error instanceof Error ? error.message : String(error)}`
      );
      records.push(record);
      appendFileSync(path, `${JSON.stringify(record)}\n`);
      finished += 1;
      return;
    }
    let record: RawBenchmarkResult;
    try {
      if (options.mock) {
        record = mockResult(
          entry.task,
          entry.mode,
          entry.repetition,
          seed,
          config,
          attempt.runId,
          entry.runKey,
          experimentHash
        );
      } else {
        const spec: RunSpec = {
          agentDir: attempt.agentDir,
          authPath: join(getAgentDir(), "auth.json"),
          benchmarkConfigHash: experimentHash,
          benchmarkConfigFileHash: loaded.hash,
          config,
          configPath: attempt.configPath,
          expectedModels: models,
          mode: entry.mode,
          modelsPath: join(getAgentDir(), "models.json"),
          repetition: entry.repetition,
          runId: attempt.runId,
          runKey: entry.runKey,
          seed,
          task: entry.task,
          telemetryToken: randomUUID(),
          workspacePath: attempt.workspace,
        };
        const child = await runChild(
          spec,
          (entry.task.timeoutSeconds ?? config.execution.timeoutSeconds) *
            1000 +
            5000
        );
        if (child.result) {
          const validationStarted = Date.now();
          const validation = await runValidator(
            entry.task.validatorPath,
            entry.task.validation.args,
            attempt.workspace,
            entry.task.validation.timeoutSeconds ??
              config.execution.validatorTimeoutSeconds ??
              config.execution.timeoutSeconds,
            {
              PI_BENCHMARK_RUN_ID: attempt.runId,
              PI_BENCHMARK_TASK_ID: entry.task.id,
            }
          );
          child.result.validation = validation;
          child.result.correct =
            validation.passed && child.result.termination.state === "settled";
          child.result.failureClass = child.result.correct
            ? "success"
            : child.result.termination.state === "timeout"
              ? "agent-timeout"
              : child.result.termination.state === "provider-error"
                ? "provider-failure"
                : (validation.failureClass ?? "validation-failure");
          child.result.validationDurationMs = Date.now() - validationStarted;
          child.result.durationMs += child.result.validationDurationMs;
          child.result.totalCost = [
            child.result.executor,
            child.result.advisor,
            child.result.scout,
          ].every(
            (role) =>
              role.invocationStatus === "inactive" ||
              role.configuredCost !== null
          )
            ? [
                child.result.executor,
                child.result.advisor,
                child.result.scout,
              ].reduce((sum, role) => sum + (role.configuredCost ?? 0), 0)
            : null;
          record = child.result;
        } else {
          record = infrastructureResult(
            entry.task,
            entry.mode,
            entry.repetition,
            seed,
            config,
            attempt.runId,
            entry.runKey,
            experimentHash,
            child.error ?? "worker failed without a diagnostic"
          );
        }
      }
      records.push(record);
      // The parent is the only writer; synchronous append keeps each record contiguous.
      appendFileSync(path, `${JSON.stringify(record)}\n`);
      finished += 1;
    } finally {
      attempt.cleanup();
    }
  };
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const index = next;
      next += 1;
      await runEntry(pending[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, () =>
      worker()
    )
  );
  clearInterval(progressTimer);
  writeFileSync(
    `${path}.schedule.json`,
    JSON.stringify(
      {
        benchmarkConfigHash: experimentHash,
        completedRunKeys: [
          ...completedKeys,
          ...records.map((record) => record.runKey),
        ].filter(Boolean),
        modes,
        runs,
        scheduleHash: hashJson(entries.map((entry) => entry.runKey)),
        seed,
        tasks: tasks.map((task) => task.id),
      },
      null,
      2
    )
  );
  return { path, records };
};
