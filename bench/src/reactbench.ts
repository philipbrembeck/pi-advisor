import { execFile, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { assertRecordedRequestPins } from "./pins.js";
import type {
  CostValue,
  ModelPin,
  PricingRates,
  RecordedProviderRequest,
} from "./types.js";

const execFileAsync = promisify(execFile);

export type TrialArm = "E" | "E+A" | "F" | "F′";

export interface ReactBenchTrialRequest {
  advisor?: ModelPin;
  arm: TrialArm;
  artifactRoot: string;
  /** USD lease left after reserving this trial's baseline estimate. */
  budgetUsd?: number;
  executor: ModelPin;
  pricing?: Partial<Record<"executor" | "advisor", PricingRates>>;
  seed: number;
  taskPath: string;
}

export interface ReactBenchTrialResult {
  attestation?: unknown;
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
const ADVISOR_ATTESTATION_PREFIX = "BENCH_ADVISOR_ATTESTATION=";
const FULL_SHA = /^[0-9a-f]{40}$/u;
export const REACTBENCH_REPOSITORY =
  "https://github.com/millionco/reactbench.git";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const lastLineWithPrefix = (lines: string[], prefix: string) =>
  lines
    .slice()
    .reverse()
    .find((value) => value.startsWith(prefix));

const parseAttestationLine = (lines: string[]) => {
  const line = lastLineWithPrefix(lines, ADVISOR_ATTESTATION_PREFIX);
  if (!line) {
    return;
  }
  try {
    return JSON.parse(line.slice(ADVISOR_ATTESTATION_PREFIX.length)) as unknown;
  } catch (error) {
    throw new TypeError(
      "ReactBench adapter emitted invalid Advisor attestation.",
      {
        cause: error,
      }
    );
  }
};

const parseResultObject = (
  line: string
): Record<string, unknown> & { passed: boolean } => {
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
  return { ...parsed, passed: parsed.passed };
};

const parseConsultations = (value: Record<string, unknown>) => {
  const consultations = value.consultations ?? 0;
  if (
    typeof consultations !== "number" ||
    !Number.isSafeInteger(consultations) ||
    consultations < 0
  ) {
    throw new TypeError(
      "ReactBench result consultations must be a non-negative integer."
    );
  }
  return consultations;
};

const parseCost = (value: Record<string, unknown>): CostValue => {
  const cost = value.cost === undefined ? "unavailable" : value.cost;
  if (
    cost !== "unavailable" &&
    (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)
  ) {
    throw new TypeError(
      "ReactBench result cost must be non-negative or unavailable."
    );
  }
  return cost as CostValue;
};

const parseRequests = (value: Record<string, unknown>) => {
  const { requests } = value;
  if (
    !Array.isArray(requests) ||
    requests.some(
      (request) =>
        !request || typeof request !== "object" || Array.isArray(request)
    )
  ) {
    throw new TypeError(
      "ReactBench result must include a provider request object array."
    );
  }
  return requests as RecordedProviderRequest[];
};

export const parseReactBenchResult = (
  output: string,
  fallbackTaskId: string
): ReactBenchTrialResult => {
  const lines = output.split(RESULT_LINE_BREAK).map((value) => value.trim());
  const line = lastLineWithPrefix(lines, "BENCH_RESULT=");
  if (!line) {
    throw new Error(
      "ReactBench adapter did not emit a BENCH_RESULT=<json> record."
    );
  }
  const parsed = parseResultObject(line);
  const lineAttestation = parseAttestationLine(lines);
  const attestation = parsed.attestation ?? lineAttestation;
  const requests = parseRequests(parsed);
  return {
    ...(attestation === undefined ? {} : { attestation }),
    consultations: parseConsultations(parsed),
    cost: parseCost(parsed),
    passed: parsed.passed,
    requests,
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
  smokeProtocol?: boolean;
  timeoutMs?: number;
}

/** Smoke-only forced consultations must never leak into screening/evaluation. */
export const assertNoSmokeProtocol = (entrypoint: string) => {
  if (process.env.BENCH_SMOKE === "1") {
    throw new Error(
      `BENCH_SMOKE=1 is reserved for the dedicated Harbor smoke invocation; refusing ${entrypoint}.`
    );
  }
};

export const buildReactBenchArgs = (
  request: ReactBenchTrialRequest,
  extraArgs: string[] = []
) => {
  if (
    request.budgetUsd !== undefined &&
    (!Number.isFinite(request.budgetUsd) || request.budgetUsd <= 0)
  ) {
    throw new TypeError("ReactBench trial budget must be finite and positive.");
  }
  return [
    ...extraArgs,
    ...(request.budgetUsd === undefined
      ? []
      : ["--budget-usd", String(request.budgetUsd)]),
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
    ...(request.pricing
      ? ["--pricing-json", JSON.stringify(request.pricing)]
      : []),
    ...(request.advisor
      ? [
          "--advisor-model",
          request.advisor.model,
          "--advisor-effort",
          request.advisor.effort,
        ]
      : []),
  ];
};

const validateRecordedRequests = (
  requests: readonly RecordedProviderRequest[],
  request: ReactBenchTrialRequest
) => {
  if (requests.length === 0) {
    throw new Error(
      "ReactBench adapter must record every provider request for pin validation."
    );
  }
  const expectedPins = [
    request.executor,
    ...(request.advisor ? [request.advisor] : []),
  ];
  const allowedRoles = new Set<string>(expectedPins.map((pin) => pin.role));
  for (const providerRequest of requests) {
    if (
      typeof providerRequest.role !== "string" ||
      !allowedRoles.has(providerRequest.role)
    ) {
      throw new Error(
        `ReactBench adapter emitted an unexpected request role: ${String(providerRequest.role)}.`
      );
    }
  }
  for (const pin of expectedPins) {
    const roleRequests = requests.filter(
      (providerRequest) => providerRequest.role === pin.role
    );
    if (pin.role === "advisor" && roleRequests.length === 0) {
      continue;
    }
    assertRecordedRequestPins(roleRequests as RecordedProviderRequest[], pin);
    if (pin.role === "advisor" && roleRequests.length > 1) {
      throw new Error(
        `ReactBench adapter emitted ${roleRequests.length} Advisor requests; expected at most 1.`
      );
    }
  }
};

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
    const args = buildReactBenchArgs(request, this.#options.extraArgs);
    const { BENCH_SMOKE: _ambientSmoke, ...hostEnvironment } = process.env;
    const result = await execFileAsync(this.#options.command, args, {
      cwd: this.#options.cwd,
      env: {
        ...hostEnvironment,
        ...(this.#options.smokeProtocol ? { BENCH_SMOKE: "1" } : {}),
        ...(request.advisor
          ? {
              BENCH_ADVISOR_EFFORT: request.advisor.effort,
              BENCH_ADVISOR_MODEL: request.advisor.model,
            }
          : {}),
        ...(request.budgetUsd === undefined
          ? {}
          : { BENCH_TRIAL_BUDGET_USD: String(request.budgetUsd) }),
        ...(request.pricing
          ? { BENCH_TRIAL_PRICING_JSON: JSON.stringify(request.pricing) }
          : {}),
        BENCH_EXECUTOR_EFFORT: request.executor.effort,
        BENCH_EXECUTOR_MODEL: request.executor.model,
        BENCH_TASK_ARM: request.arm,
        BENCH_TASK_SEED: String(request.seed),
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout: this.#options.timeoutMs ?? 2_400_000,
    });
    const parsed = parseReactBenchResult(
      `${result.stdout}\n${result.stderr}`,
      request.taskPath
    );
    if (!parsed.requests) {
      throw new Error(
        "ReactBench adapter must record every provider request for pin validation."
      );
    }
    validateRecordedRequests(parsed.requests, request);
    const advisorRequests = parsed.requests.filter(
      (providerRequest) => providerRequest.role === "advisor"
    );
    if (
      parsed.consultations !== advisorRequests.length ||
      parsed.consultations > (request.advisor ? 1 : 0)
    ) {
      throw new Error(
        "ReactBench result consultations must equal the recorded Advisor request count and stay within the session call budget."
      );
    }
    return parsed;
  }
}

const gitOutput = (args: string[]) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

const reactBenchTasksRoot = (checkoutRoot: string) => {
  const directTask = join(checkoutRoot, "hello-react", "task.toml");
  return existsSync(directTask) ? checkoutRoot : join(checkoutRoot, "tasks");
};

export const assertReactBenchCheckout = (
  root: string,
  expectedCommit: string
) => {
  if (!FULL_SHA.test(expectedCommit.trim())) {
    throw new TypeError("Expected ReactBench commit must be a full SHA-1.");
  }
  const checkoutRoot = execFileSync(
    "git",
    ["-C", resolve(root), "rev-parse", "--show-toplevel"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }
  ).trim();
  const actualCommit = gitOutput(["-C", checkoutRoot, "rev-parse", "HEAD"]);
  if (actualCommit !== expectedCommit) {
    throw new Error(
      `ReactBench checkout is not pinned: expected ${expectedCommit}, got ${actualCommit}.`
    );
  }
  if (gitOutput(["-C", checkoutRoot, "status", "--porcelain"])) {
    throw new Error(
      "ReactBench checkout is dirty; refusing a non-reproducible run."
    );
  }
  for (const required of ["pyproject.toml", "uv.lock"]) {
    if (!existsSync(join(checkoutRoot, required))) {
      throw new Error(`ReactBench checkout is missing ${required}.`);
    }
  }
  const tasksRoot = reactBenchTasksRoot(checkoutRoot);
  if (!(existsSync(tasksRoot) && statSync(tasksRoot).isDirectory())) {
    throw new Error("ReactBench checkout is missing its tasks directory.");
  }
  return { actualCommit, checkoutRoot, tasksRoot };
};

/**
 * Materialize the exact public ReactBench revision in a disposable cache when
 * the caller did not provide a checkout. Existing caches are never reset over
 * local changes; they must be clean before the pinned revision is fetched.
 */
export const ensurePinnedReactBenchCheckout = (
  expectedCommit: string,
  cacheRoot = process.env.BENCH_REACTBENCH_CACHE ??
    join(tmpdir(), `pi-advisor-reactbench-${expectedCommit.slice(0, 12)}`)
) => {
  if (!FULL_SHA.test(expectedCommit.trim())) {
    throw new TypeError("Expected ReactBench commit must be a full SHA-1.");
  }
  const checkoutRoot = resolve(cacheRoot);
  let cloned = false;
  if (!existsSync(checkoutRoot)) {
    mkdirSync(dirname(checkoutRoot), { recursive: true });
    try {
      execFileSync(
        "git",
        [
          "clone",
          "--filter=blob:none",
          "--no-checkout",
          REACTBENCH_REPOSITORY,
          checkoutRoot,
        ],
        { stdio: "ignore" }
      );
      cloned = true;
    } catch (error) {
      throw new Error("Unable to clone the pinned ReactBench repository.", {
        cause: error,
      });
    }
  }
  try {
    // A fresh --no-checkout clone reports every tracked path as deleted until
    // the pinned checkout below populates the worktree. Existing caches must
    // still be clean before they are fetched or moved.
    if (!cloned && gitOutput(["-C", checkoutRoot, "status", "--porcelain"])) {
      throw new Error("ReactBench cache is dirty; refusing to overwrite it.");
    }
    execFileSync(
      "git",
      ["-C", checkoutRoot, "fetch", "--depth=1", "origin", expectedCommit],
      { stdio: "ignore" }
    );
    execFileSync(
      "git",
      ["-C", checkoutRoot, "checkout", "--detach", expectedCommit],
      { stdio: "ignore" }
    );
  } catch (error) {
    throw new Error("Unable to materialize the pinned ReactBench checkout.", {
      cause: error,
    });
  }
  return assertReactBenchCheckout(checkoutRoot, expectedCommit);
};

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
