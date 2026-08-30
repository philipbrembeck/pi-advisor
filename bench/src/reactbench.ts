import { execFile } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { assertRecordedRequestPins } from "./pins.js";
import type { CostValue, ModelPin, RecordedProviderRequest } from "./types.js";

const execFileAsync = promisify(execFile);

export type TrialArm = "E" | "E+A" | "F" | "F′";

export interface ReactBenchTrialRequest {
  advisor?: ModelPin;
  arm: TrialArm;
  artifactRoot: string;
  executor: ModelPin;
  seed: number;
  taskPath: string;
}

export interface ReactBenchTrialResult {
  consultations: number;
  cost: CostValue;
  passed: boolean;
  requests?: RecordedProviderRequest[];
  taskId: string;
  trajectoryPath?: string;
  usage?: unknown;
}

export interface ReactBenchTrialRunner {
  run: (request: ReactBenchTrialRequest) => Promise<ReactBenchTrialResult>;
}

const RESULT_LINE_BREAK = /\r?\n/;
const REACT_BENCH_TASK = /fix-react|write-react/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parseReactBenchResult = (
  output: string,
  fallbackTaskId: string
): ReactBenchTrialResult => {
  const line = output
    .split(RESULT_LINE_BREAK)
    .map((value) => value.trim())
    .reverse()
    .find((value) => value.startsWith("BENCH_RESULT="));
  if (!line) {
    throw new Error(
      "ReactBench adapter did not emit a BENCH_RESULT=<json> record."
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice("BENCH_RESULT=".length));
  } catch (error) {
    throw new TypeError("ReactBench adapter emitted invalid result JSON.", {
      cause: error,
    });
  }
  if (!isRecord(parsed) || typeof parsed.passed !== "boolean") {
    throw new TypeError("ReactBench result must contain boolean passed.");
  }
  const consultations = parsed.consultations ?? 0;
  if (
    typeof consultations !== "number" ||
    !Number.isSafeInteger(consultations) ||
    consultations < 0
  ) {
    throw new TypeError(
      "ReactBench result consultations must be a non-negative integer."
    );
  }
  const cost = parsed.cost === undefined ? "unavailable" : parsed.cost;
  if (
    cost !== "unavailable" &&
    (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)
  ) {
    throw new TypeError(
      "ReactBench result cost must be non-negative or unavailable."
    );
  }
  const { requests } = parsed;
  if (
    requests !== undefined &&
    (!Array.isArray(requests) ||
      requests.some(
        (request) =>
          !request || typeof request !== "object" || Array.isArray(request)
      ))
  ) {
    throw new TypeError("ReactBench result requests must be an object array.");
  }
  return {
    consultations,
    cost: cost as CostValue,
    passed: parsed.passed,
    ...(requests === undefined
      ? {}
      : { requests: requests as RecordedProviderRequest[] }),
    taskId: typeof parsed.taskId === "string" ? parsed.taskId : fallbackTaskId,
    ...(typeof parsed.trajectoryPath === "string"
      ? { trajectoryPath: parsed.trajectoryPath }
      : {}),
    ...(parsed.usage === undefined ? {} : { usage: parsed.usage }),
  };
};

export interface CommandReactBenchRunnerOptions {
  artifactRoot: string;
  command: string;
  cwd?: string;
  extraArgs?: string[];
  timeoutMs?: number;
}

/**
 * Narrow process boundary for both the Harbor adapter and the approved
 * outside-Harbor fallback. The adapter owns task grading; this layer only
 * transports a structured result and never interprets a ReactBench score.
 */
export class CommandReactBenchRunner implements ReactBenchTrialRunner {
  readonly #options: CommandReactBenchRunnerOptions;

  constructor(options: CommandReactBenchRunnerOptions) {
    if (!options.command.trim()) {
      throw new TypeError("ReactBench adapter command is required.");
    }
    this.#options = options;
  }

  async run(request: ReactBenchTrialRequest) {
    const args = [
      ...(this.#options.extraArgs ?? []),
      "--task",
      request.taskPath,
      "--seed",
      String(request.seed),
      "--arm",
      request.arm,
      "--executor-model",
      request.executor.model,
      "--executor-effort",
      request.executor.effort,
      "--artifact-root",
      request.artifactRoot,
      ...(request.advisor
        ? [
            "--advisor-model",
            request.advisor.model,
            "--advisor-effort",
            request.advisor.effort,
          ]
        : []),
    ];
    const result = await execFileAsync(this.#options.command, args, {
      cwd: this.#options.cwd,
      env: { ...process.env, BENCH_TASK_ARM: request.arm },
      maxBuffer: 16 * 1024 * 1024,
      timeout: this.#options.timeoutMs ?? 2_400_000,
    });
    const parsed = parseReactBenchResult(
      `${result.stdout}\n${result.stderr}`,
      request.taskPath
    );
    if (!parsed.requests || parsed.requests.length === 0) {
      throw new Error(
        "ReactBench adapter must record every provider request for pin validation."
      );
    }
    const expectedPins = [
      request.executor,
      ...(request.advisor ? [request.advisor] : []),
    ];
    for (const pin of expectedPins) {
      const roleRequests = parsed.requests.filter(
        (providerRequest) => providerRequest.role === pin.role
      );
      assertRecordedRequestPins(roleRequests, pin);
    }
    return parsed;
  }
}

export const discoverReactBenchTasks = (root: string, limit = 30) => {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new TypeError("ReactBench task limit must be a positive integer.");
  }
  const tasks = readdirSync(root)
    .map((name) => join(root, name))
    .filter((path) => {
      try {
        return statSync(join(path, "task.toml")).isFile();
      } catch {
        return false;
      }
    })
    .map((path) => ({
      metadata: readFileSync(join(path, "task.toml"), "utf8"),
      path,
      taskId: basename(path),
    }))
    .filter(({ metadata }) => REACT_BENCH_TASK.test(metadata))
    .sort((left, right) => left.taskId.localeCompare(right.taskId))
    .slice(0, limit);
  if (tasks.length === 0) {
    throw new Error(`No ReactBench tasks found below ${root}.`);
  }
  return tasks;
};
