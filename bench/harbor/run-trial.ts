#!/usr/bin/env bun

/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: the wrapper validates the complete Harbor evidence boundary before returning a trial. */
/* biome-ignore-all lint/performance/noAwaitInLoops: infrastructure retries are intentionally sequential so only one Harbor trial can run at a time. */
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { normalizeUsage } from "../src/cost.js";
import type {
  CostValue,
  PricingRates,
  RecordedProviderRequest,
} from "../src/types.js";
import { createHarborTaskOverlay } from "./task-compat.js";

const execFileAsync = promisify(execFile);
const RESULT_PREFIX = "BENCH_RESULT=";
const ATTESTATION_PREFIX = "BENCH_ADVISOR_ATTESTATION=";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EXPECTED_AGENT_IMPORT = "bench.harbor.agent:PiAdvisorAgent";
const DEFAULT_EXTENSION_PATH = resolve(REPO_ROOT, "extensions/index.ts");
const DEFAULT_RECORDER_PATH = resolve(REPO_ROOT, "bench/harbor/recorder.ts");
const DEFAULT_CODEX_BROKER_PATH = resolve(
  REPO_ROOT,
  "bench/harbor/codex-broker.mjs"
);
const RECORDER_TARGET = "/bench-source/bench/harbor/recorder.ts";
const CODEX_UPSTREAM_URL = "https://chatgpt.com/backend-api";
const DEFAULT_PI_VERSION = "0.84.4";
const DEFAULT_EXTENSION_VERSION = "0.5.0";
export const DEFAULT_HARBOR_AGENT_TIMEOUT_SEC = 3600;
const MAX_HARBOR_AGENT_TIMEOUT_SEC = 7200;
export const MAX_HARBOR_INFRA_RETRIES = 2;
export const HARBOR_INFRA_RETRY_BACKOFF_MS = [5000, 15_000] as const;
const DEFAULT_REACTBENCH_COMMIT = "11ff042e60ec83a613053fbd721a54ed4dbfdf6f";
const BROKER_READY_PREFIX = "BENCH_CODEX_BROKER_PORT=";
const RUN_ID_PATTERN = /[^A-Za-z0-9._-]/g;
const LINE_BREAK = /\r?\n/;
const GIT_TRANSPORT_ERROR =
  /(?:RPC failed|GnuTLS|fetch-pack|early EOF|index-pack|unexpected disconnect|TLS packet|git (?:clone|fetch))/iu;
const IMAGE_PULL_ERROR =
  /(?:load metadata for|pull access denied|failed to pull|manifest unknown|no matching manifest|image .* not found)/iu;
const NETWORK_TRANSPORT_ERROR =
  /(?:connection (?:reset|timed out|closed)|network|timed out|context deadline|i\/o timeout)/iu;
const DOCKER_BUILD_ERROR =
  /(?:Docker compose command failed|failed to solve|Dockerfile|build failed)/iu;
const PI_INSTALL_HOSTS = [
  "archive.ubuntu.com",
  "deb.debian.org",
  "github.com",
  "nodejs.org",
  "raw.githubusercontent.com",
  "registry.npmjs.org",
  "security.debian.org",
  "security.ubuntu.com",
];

export type HarborTrialArm = "E" | "E+A" | "F" | "F′";
export type HarborEnvironment = "apple-container" | "docker";

export interface HarborTrialRequest {
  advisorEffort?: string;
  advisorModel?: string;
  arm: HarborTrialArm;
  artifactRoot: string;
  budgetUsd?: number;
  executorEffort: string;
  executorModel: string;
  pricing?: Partial<Record<"executor" | "advisor", PricingRates>>;
  seed: number;
  taskPath: string;
}

interface JsonObject {
  [key: string]: unknown;
}

const isObject = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const own = (value: JsonObject, key: string) => Object.hasOwn(value, key);

export type HarborInfrastructureFailureCategory =
  | "docker-build"
  | "image-pull"
  | "git-transport"
  | "network-transport";

const errorText = (error: unknown) => {
  const seen = new Set<object>();
  const parts: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) {
      return;
    }
    seen.add(value);
    if (value instanceof Error) {
      parts.push(value.message);
    }
    if (isObject(value)) {
      for (const key of ["message", "stdout", "stderr", "cause"]) {
        if (own(value, key)) {
          visit(value[key]);
        }
      }
    }
  };
  visit(error);
  return parts.join("\n");
};

export const harborInfrastructureFailureCategory = (
  error: unknown
): HarborInfrastructureFailureCategory | undefined => {
  const text = errorText(error);
  if (GIT_TRANSPORT_ERROR.test(text)) {
    return "git-transport";
  }
  if (IMAGE_PULL_ERROR.test(text)) {
    return "image-pull";
  }
  if (NETWORK_TRANSPORT_ERROR.test(text)) {
    return "network-transport";
  }
  if (DOCKER_BUILD_ERROR.test(text)) {
    return "docker-build";
  }
  return undefined;
};

const filesNamed = (root: string, name: string) => {
  const matches: string[] = [];
  const visit = (directory: string) => {
    if (!existsSync(directory)) {
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name === name) {
        matches.push(path);
      }
    }
  };
  visit(root);
  return matches;
};

const hasAgentStartup = (trialDirectory: string) =>
  filesNamed(trialDirectory, "pi.txt").length > 0;

const hasProviderRecords = (trialDirectory: string) => {
  for (const path of filesNamed(trialDirectory, "bench-records.jsonl")) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return true;
    }
    for (const line of text.split(LINE_BREAK)) {
      if (!line.trim()) {
        continue;
      }
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        return true;
      }
      if (
        isObject(value) &&
        (value.kind === "request" || value.kind === "usage")
      ) {
        return true;
      }
    }
  }
  return false;
};

export const isPreAgentHarborInfrastructureFailure = (
  error: unknown,
  trialDirectory: string
) =>
  !(hasAgentStartup(trialDirectory) || hasProviderRecords(trialDirectory)) &&
  harborInfrastructureFailureCategory(error) !== undefined;

export const harborTrialAttemptName = (trialName: string, attempt: number) => {
  if (!trialName.trim()) {
    throw new TypeError("Harbor trial name is required.");
  }
  if (!Number.isSafeInteger(attempt) || attempt < 0) {
    throw new TypeError("Harbor trial attempt must be a non-negative integer.");
  }
  return attempt === 0 ? trialName : `${trialName}-retry-${attempt}`;
};

interface HarborRetryMetadata {
  attempt: number;
  category: HarborInfrastructureFailureCategory | "unclassified";
  failedBeforeAgent: boolean;
  maxRetries: number;
  priorFailures?: HarborInfrastructureFailureCategory[];
  providerUsageRecorded: boolean;
  retryScheduled: boolean;
  retryTrialName?: string;
}

const writeHarborRetryMetadata = (
  trialDirectory: string,
  metadata: HarborRetryMetadata
) => {
  mkdirSync(trialDirectory, { recursive: true });
  writeFileSync(
    join(trialDirectory, "infrastructure-retry.json"),
    `${JSON.stringify(metadata)}\n`,
    "utf8"
  );
};

const requiredString = (value: unknown, name: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value.trim();
};

const safeInteger = (value: string, name: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  }
  return parsed;
};

export const parseHarborTrialArgs = (argv: string[]): HarborTrialRequest => {
  const values = new Map<string, string>();
  const known = new Set([
    "task",
    "seed",
    "arm",
    "executor-model",
    "executor-effort",
    "advisor-model",
    "advisor-effort",
    "artifact-root",
    "budget-usd",
    "pricing-json",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) {
      throw new TypeError(
        `Unexpected Harbor adapter argument: ${flag ?? "missing"}`
      );
    }
    const key = flag.slice(2);
    if (!known.has(key)) {
      throw new TypeError(`Unknown Harbor adapter argument: --${key}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new TypeError(`Missing value for --${key}.`);
    }
    if (values.has(key)) {
      throw new TypeError(`Duplicate Harbor adapter argument: --${key}.`);
    }
    values.set(key, value);
    index += 1;
  }

  const arm = requiredString(values.get("arm"), "arm") as HarborTrialArm;
  if (!["E", "E+A", "F", "F′"].includes(arm)) {
    throw new TypeError(`Unsupported benchmark arm: ${arm}`);
  }
  const executorModel = requiredString(
    values.get("executor-model"),
    "executor-model"
  );
  const executorEffort = requiredString(
    values.get("executor-effort"),
    "executor-effort"
  );
  const advisorModel = values.get("advisor-model")?.trim() || undefined;
  const advisorEffort = values.get("advisor-effort")?.trim() || undefined;
  if (arm === "E+A" && !(advisorModel && advisorEffort)) {
    throw new TypeError("E+A requires advisor-model and advisor-effort.");
  }
  if (arm !== "E+A" && (advisorModel || advisorEffort)) {
    throw new TypeError("Only E+A may carry an Advisor model pin.");
  }

  let budgetUsd: number | undefined;
  const budgetText = values.get("budget-usd");
  if (budgetText !== undefined) {
    budgetUsd = Number(budgetText);
    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
      throw new TypeError("budget-usd must be finite and positive.");
    }
  }

  let pricing: HarborTrialRequest["pricing"];
  const pricingText = values.get("pricing-json");
  if (pricingText !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(pricingText);
    } catch (error) {
      throw new TypeError("pricing-json must contain valid JSON.", {
        cause: error,
      });
    }
    if (!isObject(parsed)) {
      throw new TypeError("pricing-json must be an object.");
    }
    pricing = parsed as HarborTrialRequest["pricing"];
  }

  return {
    ...(advisorEffort ? { advisorEffort } : {}),
    ...(advisorModel ? { advisorModel } : {}),
    arm,
    artifactRoot: requiredString(values.get("artifact-root"), "artifact-root"),
    ...(budgetUsd === undefined ? {} : { budgetUsd }),
    executorEffort,
    executorModel,
    ...(pricing ? { pricing } : {}),
    seed: safeInteger(requiredString(values.get("seed"), "seed"), "seed"),
    taskPath: requiredString(values.get("task"), "task"),
  };
};

const readEnv = (name: string) => {
  const value = process.env[name]?.trim();
  return value || undefined;
};

export const parseHarborEnvironment = (
  value: string | undefined
): HarborEnvironment | undefined => {
  if (!value || value === "docker") {
    return value ? "docker" : undefined;
  }
  if (value === "apple-container") {
    return value;
  }
  throw new TypeError(
    "BENCH_HARBOR_ENV must be docker or apple-container when set."
  );
};

export const parseHarborAgentTimeout = (value: string | undefined) => {
  if (!value) {
    return DEFAULT_HARBOR_AGENT_TIMEOUT_SEC;
  }
  const timeout = Number(value);
  if (
    !Number.isFinite(timeout) ||
    timeout <= 0 ||
    timeout > MAX_HARBOR_AGENT_TIMEOUT_SEC
  ) {
    throw new TypeError(
      `BENCH_HARBOR_AGENT_TIMEOUT_SEC must be finite and between 1 and ${MAX_HARBOR_AGENT_TIMEOUT_SEC} seconds.`
    );
  }
  return timeout;
};

const requireFile = (path: string, label: string) => {
  if (!(existsSync(path) && statSync(path).isFile())) {
    throw new Error(`${label} is missing: ${path}`);
  }
};

const requireDirectory = (path: string, label: string) => {
  if (!(existsSync(path) && statSync(path).isDirectory())) {
    throw new Error(`${label} is missing: ${path}`);
  }
};

const checkoutRootFor = (taskPath: string, sourceRoot?: string) => {
  try {
    return execFileSync(
      "git",
      ["-C", taskPath, "rev-parse", "--show-toplevel"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    ).trim();
  } catch (error) {
    const candidate = sourceRoot ? resolve(sourceRoot) : undefined;
    if (candidate && existsSync(join(candidate, "pyproject.toml"))) {
      return candidate;
    }
    throw new Error(
      "ReactBench task is not inside a Git checkout and no ReactBench pyproject.toml was found.",
      { cause: error }
    );
  }
};

const safePart = (value: string) =>
  value.replace(RUN_ID_PATTERN, "-").replace(/^-+|-+$/g, "") || "run";

const trialNameFor = (
  taskId: string,
  arm: HarborTrialArm,
  seed: number,
  smokeProtocol = false
) => {
  const runId = safePart(
    readEnv("BENCH_RUN_ID") ?? `${Date.now()}-${process.pid}`
  );
  const protocol = smokeProtocol ? "smoke-" : "";
  return `pi-advisor-${safePart(taskId).slice(0, 64)}-${safePart(arm)}-${seed}-${protocol}${runId.slice(-32)}`;
};

const proxyHost = (proxyUrl: string) => {
  let url: URL;
  try {
    url = new URL(proxyUrl);
  } catch (error) {
    throw new TypeError("Codex broker URL must be an absolute http(s) URL.", {
      cause: error,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Codex broker URL must use http or https.");
  }
  return url.hostname;
};

const parseAllowHosts = (host: string) => {
  const extra = (readEnv("BENCH_HARBOR_ALLOW_HOSTS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([host, ...PI_INSTALL_HOSTS, ...extra])];
};

const PRICING_KEYS = [
  "inputPerMillion",
  "outputPerMillion",
  "cacheReadPerMillion",
  "cacheWritePerMillion",
] as const;

const pricingFor = (
  pricing: HarborTrialRequest["pricing"],
  role: "executor" | "advisor"
) => {
  const value = pricing?.[role];
  if (!isObject(value)) {
    return;
  }
  if (
    Object.keys(value).some(
      (key) => !(PRICING_KEYS as readonly string[]).includes(key)
    ) ||
    PRICING_KEYS.some(
      (key) =>
        typeof value[key] !== "number" ||
        !Number.isFinite(value[key]) ||
        value[key] < 0
    )
  ) {
    throw new TypeError(`Invalid ${role} pricing in pricing-json.`);
  }
  return value as PricingRates;
};

const samePricing = (
  left: PricingRates | undefined,
  right: PricingRates | undefined
) => {
  if (!(left && right)) {
    return false;
  }
  return PRICING_KEYS.every((key) => left[key] === right[key]);
};

export const validateHarborTrialPricing = (request: HarborTrialRequest) => {
  const pricedRoles =
    request.arm === "E+A"
      ? (["executor", "advisor"] as const)
      : (["executor"] as const);
  for (const role of pricedRoles) {
    const rates = pricingFor(request.pricing, role);
    if (!rates || PRICING_KEYS.every((key) => rates[key] === 0)) {
      throw new Error(
        `Missing non-zero ${role} pricing; refusing an unpriced Harbor trial.`
      );
    }
  }
  if (
    request.arm === "E+A" &&
    request.executorModel === request.advisorModel &&
    !samePricing(
      pricingFor(request.pricing, "executor"),
      pricingFor(request.pricing, "advisor")
    )
  ) {
    throw new Error(
      "Executor and Advisor cannot share a model with different trial pricing."
    );
  }
};

const aggregateUsage = (requests: RecordedProviderRequest[]) => {
  const result = {
    cacheRead: 0,
    cacheWrite: 0,
    input: 0,
    output: 0,
    totalTokens: 0,
    usageAvailable: true,
  };
  for (const request of requests) {
    const snapshot = normalizeUsage(request.usage);
    if (!snapshot.usageAvailable) {
      result.usageAvailable = false;
    }
    result.cacheRead += snapshot.cacheRead ?? 0;
    result.cacheWrite += snapshot.cacheWrite ?? 0;
    result.input += snapshot.input ?? 0;
    result.output += snapshot.output ?? 0;
    result.totalTokens += snapshot.totalTokens ?? 0;
  }
  return result;
};

const costFor = (
  requests: RecordedProviderRequest[],
  pricing: HarborTrialRequest["pricing"]
): CostValue => {
  let total = 0;
  for (const request of requests) {
    const role = request.role === "advisor" ? "advisor" : "executor";
    const rates = pricingFor(pricing, role);
    const usage = normalizeUsage(request.usage);
    if (!(rates && usage.usageAvailable)) {
      return "unavailable";
    }
    total +=
      ((usage.input ?? 0) * rates.inputPerMillion +
        (usage.output ?? 0) * rates.outputPerMillion +
        (usage.cacheRead ?? 0) * rates.cacheReadPerMillion +
        (usage.cacheWrite ?? 0) * rates.cacheWritePerMillion) /
      1_000_000;
  }
  return total;
};

const readJson = (path: string, label: string): JsonObject => {
  requireFile(path, label);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new TypeError(`${label} is not valid JSON: ${path}`, {
      cause: error,
    });
  }
  if (!isObject(value)) {
    throw new TypeError(`${label} must contain an object: ${path}`);
  }
  return value;
};

const validateCodexAuthFile = (path: string) => {
  const auth = readJson(path, "Pi Codex OAuth auth file");
  const credential = auth["openai-codex"];
  if (
    !isObject(credential) ||
    credential.type !== "oauth" ||
    typeof credential.access !== "string" ||
    !credential.access.trim() ||
    typeof credential.refresh !== "string" ||
    !credential.refresh.trim() ||
    typeof credential.expires !== "number" ||
    !Number.isFinite(credential.expires)
  ) {
    throw new Error(
      "Pi Codex OAuth auth file has no usable openai-codex credential."
    );
  }
};

const startCodexBroker = ({
  authFile,
  request,
  token,
}: {
  authFile: string;
  request: HarborTrialRequest;
  token: string;
}) => {
  const child = spawn(process.execPath, [DEFAULT_CODEX_BROKER_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      BENCH_ADVISOR_MODEL: request.advisorModel ?? "",
      BENCH_CODEX_AUTH_FILE: authFile,
      BENCH_CODEX_PROXY_TOKEN: token,
      BENCH_CODEX_UPSTREAM_URL: CODEX_UPSTREAM_URL,
      BENCH_EXECUTOR_MODEL: request.executorModel,
      BENCH_PROXY_PORT: "0",
      BENCH_TRIAL_BUDGET_USD: String(request.budgetUsd),
      BENCH_TRIAL_PRICING_JSON: JSON.stringify(request.pricing ?? {}),
    },
    stdio: ["ignore", "pipe", "ignore"],
  });

  return new Promise<{ child: ReturnType<typeof spawn>; port: number }>(
    (resolveReady, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill("SIGTERM");
          reject(new Error("Codex broker did not become ready."));
        }
      }, 15_000);
      const fail = (message: string) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGTERM");
        reject(new Error(message));
      };
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        const match = chunk.match(new RegExp(`${BROKER_READY_PREFIX}(\\d+)`));
        if (!match) {
          return;
        }
        const port = Number(match[1]);
        if (!Number.isInteger(port) || port <= 0 || port >= 65_536) {
          fail("Codex broker reported an invalid port.");
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolveReady({ child, port });
      });
      child.once("error", () => fail("Codex broker failed to start."));
      child.once("exit", (code) => {
        if (!settled) {
          fail(
            `Codex broker exited before becoming ready (code ${code ?? "unknown"}).`
          );
        }
      });
    }
  );
};

const stopCodexBroker = async (child: ReturnType<typeof spawn>) => {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolveStopped) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolveStopped();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveStopped();
    });
    child.kill("SIGTERM");
  });
};

type CommandRunner = (
  command: string,
  args: string[],
  options: { maxBuffer: number }
) => Promise<unknown>;

export const pruneDockerBuildCache = async (
  harborEnvironment: HarborEnvironment | undefined,
  options: {
    enabled?: boolean;
    run?: CommandRunner;
  } = {}
) => {
  if (
    harborEnvironment === "apple-container" ||
    (options.enabled ?? readEnv("BENCH_HARBOR_PRUNE") === "1") === false
  ) {
    return;
  }
  try {
    await (
      options.run ??
      ((command, args, runOptions) => execFileAsync(command, args, runOptions))
    )("docker", ["builder", "prune", "--all", "--force"], {
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    process.stderr.write(
      "Harbor Docker build-cache cleanup failed; inspect Docker disk usage before continuing.\n"
    );
  }
};

const artifactDirectory = (trialDir: string, name: "agent" | "verifier") => {
  const direct = join(trialDir, name);
  if (existsSync(direct) && statSync(direct).isDirectory()) {
    return direct;
  }
  const steps = join(trialDir, "steps");
  if (existsSync(steps) && statSync(steps).isDirectory()) {
    const matches = readdirSync(steps)
      .map((step) => join(steps, step, name))
      .filter((path) => existsSync(path) && statSync(path).isDirectory());
    if (matches.length === 1) {
      return matches[0];
    }
  }
  throw new Error(`Harbor ${name} artifact directory is missing: ${trialDir}`);
};

const sameJsonFields = (
  left: JsonObject,
  right: JsonObject,
  fields: string[]
) => fields.every((field) => left[field] === right[field]);

const expectedMode = (arm: HarborTrialArm) =>
  arm === "E+A" ? "advisor" : "executor";

const expectedSmokeProtocol = (
  request: HarborTrialRequest,
  smokeProtocol: boolean
) => request.arm === "E+A" && smokeProtocol;

const validateAttestation = (
  value: unknown,
  request: HarborTrialRequest,
  expectedVersion: string,
  smokeProtocol: boolean
): JsonObject => {
  if (!isObject(value)) {
    throw new TypeError("Harbor attestation must be an object.");
  }
  const expectedSmoke = expectedSmokeProtocol(request, smokeProtocol);
  const validAdvisorCalls =
    typeof value.advisorCalls === "number" &&
    Number.isSafeInteger(value.advisorCalls) &&
    value.advisorCalls >= 0 &&
    (request.arm === "E+A"
      ? value.advisorCalls <= 1 && (!expectedSmoke || value.advisorCalls === 1)
      : value.advisorCalls === 0);
  if (
    value.adapter !== "pi-advisor-harbor" ||
    value.extension !== "pi-advisor-flow" ||
    value.loaded !== true ||
    value.extensionVersion !== expectedVersion ||
    value.mode !== expectedMode(request.arm) ||
    value.shutdown !== true ||
    value.smokeProtocol !== expectedSmoke ||
    !validAdvisorCalls
  ) {
    throw new Error(
      "Harbor trial did not attest the pinned extension, mode, clean shutdown, and bounded consultation count."
    );
  }
  return value;
};

const parseRecords = (path: string) => {
  requireFile(path, "Harbor request/usage record");
  const records: JsonObject[] = [];
  const lines = readFileSync(path, "utf8").split(LINE_BREAK);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new TypeError(`Malformed Harbor record at line ${index + 1}.`, {
        cause: error,
      });
    }
    if (!isObject(value)) {
      throw new TypeError(
        `Harbor record at line ${index + 1} is not an object.`
      );
    }
    records.push(value);
  }
  if (records.length === 0) {
    throw new Error("Harbor request/usage record is empty.");
  }
  return records;
};

const validateRequests = (
  records: JsonObject[],
  request: HarborTrialRequest
): RecordedProviderRequest[] => {
  const requests = records.filter((record) => record.kind === "request");
  if (requests.length === 0) {
    throw new Error("Harbor trial produced no provider request records.");
  }
  const advisorRequests = requests.filter(
    (record) => record.role === "advisor"
  );
  if (
    (request.arm !== "E+A" && advisorRequests.length !== 0) ||
    (request.arm === "E+A" && advisorRequests.length > 1)
  ) {
    throw new Error(
      `Harbor Advisor request count exceeds the pinned session budget: got ${advisorRequests.length}.`
    );
  }

  const normalExecutorUsage = records.filter(
    (record) =>
      record.kind === "usage" &&
      record.role === "executor" &&
      record.source === "message_end"
  );
  let normalUsageIndex = 0;
  const normalized: RecordedProviderRequest[] = [];
  for (const record of requests) {
    const { role, source } = record;
    if (role !== "executor" && role !== "advisor") {
      throw new Error(`Unexpected Harbor request role: ${String(role)}.`);
    }
    if (
      source !== "before_provider_request" &&
      source !== "ask_advisor_tool_result" &&
      source !== "advisor_scout"
    ) {
      throw new Error(`Unexpected Harbor request source: ${String(source)}.`);
    }
    const model = requiredString(record.model, `${role} request model`);
    const effort = requiredString(record.effort, `${role} request effort`);
    const expectedModel =
      role === "advisor" ? request.advisorModel : request.executorModel;
    const expectedEffort =
      role === "advisor" ? request.advisorEffort : request.executorEffort;
    if (model !== expectedModel || effort !== expectedEffort) {
      throw new Error(
        `Harbor request pin mismatch for ${role}: expected ${expectedModel}@${expectedEffort}, got ${model}@${effort}.`
      );
    }
    if (role === "advisor" && source !== "ask_advisor_tool_result") {
      throw new Error(
        "Advisor requests must come from ask_advisor tool results."
      );
    }
    if (role === "executor" && source === "ask_advisor_tool_result") {
      throw new Error(
        "Executor requests cannot be labeled as Advisor tool results."
      );
    }
    let { usage } = record;
    if (source === "before_provider_request") {
      const usageRecord = normalExecutorUsage[normalUsageIndex];
      normalUsageIndex += 1;
      if (
        !(usageRecord && own(usageRecord, "usage")) ||
        usageRecord.usage === undefined
      ) {
        throw new Error(
          "A Harbor executor request is missing its usage artifact."
        );
      }
      ({ usage } = usageRecord);
    } else if (!own(record, "usage")) {
      throw new Error(
        `A Harbor ${role} request is missing its usage artifact.`
      );
    }
    if (!normalizeUsage(usage).usageAvailable) {
      throw new Error(
        `A Harbor ${role} request contains malformed or incomplete usage.`
      );
    }
    normalized.push({
      ...record,
      effort,
      model,
      role,
      usage,
    });
  }
  if (normalUsageIndex !== normalExecutorUsage.length) {
    throw new Error("Harbor usage artifacts do not match executor requests.");
  }
  return normalized;
};

const validateGrader = (trial: JsonObject, verifierDirectory: string) => {
  const rewardFile = readJson(
    join(verifierDirectory, "reward.json"),
    "Harbor grader reward"
  );
  const { reward, react_doctor: reactDoctor, tests } = rewardFile;
  if (
    typeof reward !== "number" ||
    !Number.isFinite(reward) ||
    (reward !== 0 && reward !== 1) ||
    typeof tests !== "number" ||
    !Number.isFinite(tests) ||
    (tests !== 0 && tests !== 1) ||
    typeof reactDoctor !== "number" ||
    !Number.isFinite(reactDoctor) ||
    (reactDoctor !== 0 && reactDoctor !== 1)
  ) {
    throw new TypeError(
      "ReactBench grader must record binary reward, behavioral-test, and React Doctor results."
    );
  }
  if (reward === 1 && !(tests === 1 && reactDoctor === 1)) {
    throw new Error(
      "ReactBench grader reward claims a pass without both behavioral tests and React Doctor passing."
    );
  }
  const verifierResult = trial.verifier_result;
  if (!(isObject(verifierResult) && isObject(verifierResult.rewards))) {
    throw new Error("Harbor result is missing its verifier result artifact.");
  }
  if (verifierResult.rewards.reward !== reward) {
    throw new Error("Harbor result and grader reward artifacts disagree.");
  }
  return reward === 1;
};

const validateTrialIdentity = (
  trial: JsonObject,
  request: HarborTrialRequest,
  trialName: string,
  expectedAgentTimeoutSec?: number
) => {
  if (trial.trial_name !== trialName) {
    throw new Error("Harbor result belongs to a different trial.");
  }
  if (trial.exception_info !== null && trial.exception_info !== undefined) {
    throw new Error("Harbor trial contains an exception artifact.");
  }
  if (expectedAgentTimeoutSec !== undefined) {
    const agentConfig = isObject(trial.config) ? trial.config.agent : undefined;
    if (
      !isObject(agentConfig) ||
      agentConfig.override_timeout_sec !== expectedAgentTimeoutSec
    ) {
      throw new Error(
        `Harbor result does not attest the pinned agent timeout of ${expectedAgentTimeoutSec} seconds.`
      );
    }
  }
  const modelInfo = isObject(trial.agent_info)
    ? trial.agent_info.model_info
    : undefined;
  if (
    !(
      isObject(modelInfo) &&
      typeof modelInfo.provider === "string" &&
      typeof modelInfo.name === "string"
    )
  ) {
    throw new Error("Harbor result is missing its resolved agent model pin.");
  }
  const reportedModel = `${modelInfo.provider}/${modelInfo.name}`;
  if (reportedModel !== request.executorModel) {
    throw new Error(
      `Harbor result agent model mismatch: expected ${request.executorModel}, got ${reportedModel}.`
    );
  }
};

export interface HarborArtifactValidationOptions {
  agentTimeoutSec?: number;
  smokeProtocol?: boolean;
}

export const validateHarborArtifacts = (
  trialDirectory: string,
  request: HarborTrialRequest,
  extensionVersion: string,
  options: HarborArtifactValidationOptions = {}
) => {
  const smokeProtocol = options.smokeProtocol === true;
  const trialName = basename(trialDirectory);
  const taskId = basename(resolve(request.taskPath));
  const agentDirectory = artifactDirectory(trialDirectory, "agent");
  const verifierDirectory = artifactDirectory(trialDirectory, "verifier");
  requireFile(join(agentDirectory, "pi.txt"), "Harbor Pi trajectory");
  const records = parseRecords(join(agentDirectory, "bench-records.jsonl"));
  const attestation = validateAttestation(
    readJson(
      join(agentDirectory, "bench-attestation.json"),
      "Harbor attestation"
    ),
    request,
    extensionVersion,
    smokeProtocol
  );
  const extensionLoaded = records.find(
    (record) => record.kind === "extension_loaded"
  );
  if (
    extensionLoaded?.extension !== "pi-advisor-flow" ||
    extensionLoaded?.extensionVersion !== extensionVersion ||
    extensionLoaded?.loaded !== true ||
    extensionLoaded?.smokeProtocol !==
      expectedSmokeProtocol(request, smokeProtocol)
  ) {
    throw new Error("Harbor records do not prove the pinned extension loaded.");
  }
  const finalAttestation = records
    .filter((record) => record.kind === "attestation")
    .at(-1);
  if (
    !(
      finalAttestation &&
      sameJsonFields(finalAttestation, attestation, [
        "adapter",
        "advisorCalls",
        "extension",
        "extensionVersion",
        "loaded",
        "mode",
        "shutdown",
        "smokeProtocol",
      ])
    )
  ) {
    throw new Error(
      "Harbor attestation artifact does not match its final record."
    );
  }

  const trialResultPath = existsSync(join(trialDirectory, "result.json"))
    ? join(trialDirectory, "result.json")
    : join(trialDirectory, "results.json");
  const trial = readJson(trialResultPath, "Harbor trial result");
  validateTrialIdentity(trial, request, trialName, options.agentTimeoutSec);
  const passed = validateGrader(trial, verifierDirectory);
  const requests = validateRequests(records, request);
  if (
    attestation.advisorCalls !==
    requests.filter((item) => item.role === "advisor").length
  ) {
    throw new Error(
      "Harbor attestation consultation count does not match recorded Advisor requests."
    );
  }
  const executorRequests = requests.filter((item) => item.role === "executor");
  const advisorRequests = requests.filter((item) => item.role === "advisor");
  const usage = {
    advisor: aggregateUsage(advisorRequests),
    executor: aggregateUsage(executorRequests),
  };
  return {
    attestation,
    consultations: advisorRequests.length,
    cost: costFor(requests, request.pricing),
    passed,
    requests,
    taskId,
    trajectoryPath: trialDirectory,
    usage,
  };
};

interface HarborInvocationOptions {
  agentTimeoutSec?: number;
  artifactRoot: string;
  codexBrokerToken: string;
  codexProxyUrl: string;
  extensionPath: string;
  extensionVersion: string;
  harborBinary: string;
  harborEnvironment?: HarborEnvironment;
  piVersion: string;
  recorderPath: string;
  request: HarborTrialRequest;
  smokeProtocol?: boolean;
  trialName: string;
}

export const buildHarborTrialArgs = ({
  agentTimeoutSec: configuredAgentTimeoutSec,
  artifactRoot,
  codexBrokerToken,
  codexProxyUrl,
  extensionPath,
  extensionVersion,
  harborBinary,
  harborEnvironment,
  piVersion,
  recorderPath,
  request,
  smokeProtocol = false,
  trialName,
}: HarborInvocationOptions) => {
  const extensionDirectory = dirname(extensionPath);
  const extensionSourceDirectory = resolve(extensionDirectory, "../src");
  const extensionFilename = basename(extensionPath);
  const mounts = [
    {
      read_only: true,
      source: extensionDirectory,
      target: "/bench-source/extensions",
      type: "bind",
    },
    {
      read_only: true,
      source: extensionSourceDirectory,
      target: "/bench-source/src",
      type: "bind",
    },
    {
      read_only: true,
      source: recorderPath,
      target: RECORDER_TARGET,
      type: "bind",
    },
  ];
  const agentTimeoutSec =
    configuredAgentTimeoutSec === undefined
      ? parseHarborAgentTimeout(readEnv("BENCH_HARBOR_AGENT_TIMEOUT_SEC"))
      : parseHarborAgentTimeout(String(configuredAgentTimeoutSec));
  const agentKwargs = [
    `version=${piVersion}`,
    `thinking=${request.executorEffort}`,
    `extension_path=/bench-source/extensions/${extensionFilename}`,
    `extension_version=${extensionVersion}`,
    `benchmark_arm=${request.arm}`,
    "model_api=openai-codex-responses",
    `codex_proxy_url=${codexProxyUrl}`,
    `codex_broker_token=${codexBrokerToken}`,
    `scout_enabled=${readEnv("BENCH_SCOUT") === "1" ? "true" : "false"}`,
    ...(smokeProtocol ? ["smoke_protocol=true"] : []),
  ];
  if (request.arm === "E+A") {
    agentKwargs.push(`advisor_model=${request.advisorModel}`);
    agentKwargs.push(`advisor_effort=${request.advisorEffort}`);
  }
  const harborPrefix =
    harborBinary === "uv"
      ? ["run", "--locked", "harbor", "trial", "start"]
      : ["trial", "start"];
  return [
    ...harborPrefix,
    "--path",
    request.taskPath,
    "--trial-name",
    trialName,
    "--trials-dir",
    artifactRoot,
    ...(harborEnvironment ? ["--env", harborEnvironment] : []),
    "--agent-timeout",
    String(agentTimeoutSec),
    "--agent",
    EXPECTED_AGENT_IMPORT,
    "--model",
    request.executorModel,
    ...agentKwargs.flatMap((value) => ["--agent-kwarg", value]),
    "--agent-env",
    `BENCH_TRIAL_BUDGET_USD=${request.budgetUsd}`,
    "--agent-env",
    `BENCH_TRIAL_PRICING_JSON=${JSON.stringify(request.pricing ?? {})}`,
    "--agent-env",
    `BENCH_SMOKE_PROTOCOL=${smokeProtocol ? "true" : "false"}`,
    "--mounts",
    JSON.stringify(mounts),
    ...parseAllowHosts(proxyHost(codexProxyUrl)).flatMap((host) => [
      "--allow-agent-host",
      host,
      "--allow-environment-host",
      host,
    ]),
  ];
};

export const runTrial = async (request: HarborTrialRequest) => {
  if (process.env.BENCH_LIVE !== "1") {
    throw new Error(
      "BENCH_LIVE=1 is required; refusing to start a paid Harbor trial."
    );
  }
  const sourceRoot = readEnv("BENCH_REACTBENCH_ROOT");
  if (
    request.budgetUsd === undefined ||
    !Number.isFinite(request.budgetUsd) ||
    request.budgetUsd <= 0
  ) {
    throw new Error(
      "--budget-usd must be finite and positive; refusing an unbounded Harbor trial."
    );
  }
  validateHarborTrialPricing(request);
  const taskPath = resolve(request.taskPath);
  requireFile(join(taskPath, "task.toml"), "ReactBench task definition");
  const checkoutRoot = checkoutRootFor(taskPath, sourceRoot);
  const checkoutCommit = execFileSync(
    "git",
    ["-C", checkoutRoot, "rev-parse", "HEAD"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  ).trim();
  if (checkoutCommit !== DEFAULT_REACTBENCH_COMMIT) {
    throw new Error(
      `ReactBench checkout is not pinned: expected ${DEFAULT_REACTBENCH_COMMIT}, got ${checkoutCommit}.`
    );
  }
  if (
    execFileSync("git", ["-C", checkoutRoot, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  ) {
    throw new Error(
      "ReactBench checkout is dirty; refusing a non-reproducible trial."
    );
  }
  requireFile(
    join(checkoutRoot, "pyproject.toml"),
    "ReactBench pyproject.toml"
  );
  requireFile(join(checkoutRoot, "uv.lock"), "ReactBench uv.lock");

  const extensionPath = resolve(
    readEnv("BENCH_PI_ADVISOR_EXTENSION") ?? DEFAULT_EXTENSION_PATH
  );
  const recorderPath = resolve(
    readEnv("BENCH_PI_ADVISOR_RECORDER") ?? DEFAULT_RECORDER_PATH
  );
  requireFile(extensionPath, "Pinned pi-advisor extension");
  requireFile(recorderPath, "Benchmark recorder");
  requireFile(DEFAULT_CODEX_BROKER_PATH, "Codex OAuth broker");
  requireFile(resolve(REPO_ROOT, "bench/harbor/agent.py"), "Harbor Pi agent");
  const extensionDirectory = dirname(extensionPath);
  const extensionSourceDirectory = resolve(extensionDirectory, "../src");
  requireDirectory(extensionSourceDirectory, "Pinned pi-advisor source");

  const authFile = resolve(
    readEnv("BENCH_PI_ADVISOR_AUTH_FILE") ??
      join(homedir(), ".pi", "agent", "auth.json")
  );
  validateCodexAuthFile(authFile);
  const extensionVersion =
    readEnv("BENCH_PI_ADVISOR_VERSION") ?? DEFAULT_EXTENSION_VERSION;
  const piVersion = readEnv("BENCH_PI_VERSION") ?? DEFAULT_PI_VERSION;

  const taskId = basename(taskPath);
  const smokeProtocol = request.arm === "E+A" && readEnv("BENCH_SMOKE") === "1";
  const trialName = trialNameFor(
    taskId,
    request.arm,
    request.seed,
    smokeProtocol
  );
  const requestedArtifactRoot = resolve(request.artifactRoot);
  mkdirSync(requestedArtifactRoot, { recursive: true });
  const artifactRoot = realpathSync(requestedArtifactRoot);
  const trialDirectory = join(artifactRoot, trialName);
  if (existsSync(trialDirectory)) {
    throw new Error(
      `Refusing to overwrite existing Harbor artifacts: ${trialDirectory}`
    );
  }

  const configuredHarborBinary = readEnv("BENCH_HARBOR_BIN");
  const harborBinary = configuredHarborBinary ?? "uv";
  const harborEnvironment = parseHarborEnvironment(readEnv("BENCH_HARBOR_ENV"));
  const agentTimeoutSec = parseHarborAgentTimeout(
    readEnv("BENCH_HARBOR_AGENT_TIMEOUT_SEC")
  );
  const codexProxyHost =
    harborEnvironment === "apple-container"
      ? "host.container.internal"
      : "host.docker.internal";
  const harborTask = createHarborTaskOverlay(taskPath);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: [REPO_ROOT, process.env.PYTHONPATH].filter(Boolean).join(":"),
  };
  // Do not let host credentials, broker settings, or the selected auth-file
  // path enter Harbor's launcher environment. The OAuth credential is
  // available only to the broker child; the per-trial broker token is passed
  // separately as an intentional agent kwarg.
  for (const name of [
    "BENCH_SMOKE",
    "BENCH_API_KEY",
    "BENCH_BASE_URL",
    "BENCH_CODEX_AUTH_FILE",
    "BENCH_CODEX_PROXY_TOKEN",
    "BENCH_CODEX_UPSTREAM_URL",
    "BENCH_PI_ADVISOR_AUTH_FILE",
    "OPENAI_API_KEY",
    "OPENAI_ACCESS_TOKEN",
  ]) {
    delete env[name];
  }

  const retryCategories: HarborInfrastructureFailureCategory[] = [];
  try {
    for (let attempt = 0; attempt <= MAX_HARBOR_INFRA_RETRIES; attempt += 1) {
      const attemptTrialName = harborTrialAttemptName(trialName, attempt);
      const attemptTrialDirectory = join(artifactRoot, attemptTrialName);
      if (existsSync(attemptTrialDirectory)) {
        throw new Error(
          `Refusing to overwrite existing Harbor artifacts: ${attemptTrialDirectory}`
        );
      }

      const brokerToken = randomBytes(32).toString("hex");
      let broker: Awaited<ReturnType<typeof startCodexBroker>> | undefined;
      let attemptFailed = false;
      let failure: unknown;
      try {
        broker = await startCodexBroker({
          authFile,
          request,
          token: brokerToken,
        });
        const codexProxyUrl = `http://${codexProxyHost}:${broker.port}`;
        const args = buildHarborTrialArgs({
          agentTimeoutSec,
          artifactRoot,
          codexBrokerToken: brokerToken,
          codexProxyUrl,
          extensionPath,
          extensionVersion,
          harborBinary,
          harborEnvironment,
          piVersion,
          recorderPath,
          request: { ...request, taskPath: harborTask.taskPath },
          smokeProtocol,
          trialName: attemptTrialName,
        });
        await execFileAsync(harborBinary, args, {
          cwd: checkoutRoot,
          env,
          maxBuffer: 64 * 1024 * 1024,
        });
      } catch (error) {
        attemptFailed = true;
        failure = error;
      } finally {
        if (broker) {
          await stopCodexBroker(broker.child);
        }
        await pruneDockerBuildCache(harborEnvironment);
      }

      if (attemptFailed) {
        const category =
          harborInfrastructureFailureCategory(failure) ?? "unclassified";
        const failedBeforeAgent = !hasAgentStartup(attemptTrialDirectory);
        const providerUsageRecorded = hasProviderRecords(attemptTrialDirectory);
        const retryable =
          category !== "unclassified" &&
          failedBeforeAgent &&
          !providerUsageRecorded &&
          attempt < MAX_HARBOR_INFRA_RETRIES;
        const retryTrialName = retryable
          ? harborTrialAttemptName(trialName, attempt + 1)
          : undefined;
        writeHarborRetryMetadata(attemptTrialDirectory, {
          attempt: attempt + 1,
          category,
          failedBeforeAgent,
          maxRetries: MAX_HARBOR_INFRA_RETRIES,
          providerUsageRecorded,
          retryScheduled: retryable,
          ...(retryTrialName ? { retryTrialName } : {}),
          ...(retryCategories.length > 0
            ? { priorFailures: [...retryCategories] }
            : {}),
        });
        if (retryable) {
          retryCategories.push(category);
          const backoffMs = HARBOR_INFRA_RETRY_BACKOFF_MS[attempt];
          if (backoffMs !== undefined) {
            await new Promise<void>((resolveDelay) =>
              setTimeout(resolveDelay, backoffMs)
            );
          }
          continue;
        }
        const code =
          isObject(failure) &&
          (typeof failure.code === "number" || typeof failure.code === "string")
            ? String(failure.code)
            : "unknown";
        throw new Error(
          `Harbor trial failed with exit code ${code}; inspect ${attemptTrialDirectory}.`,
          { cause: failure }
        );
      }

      const result = validateHarborArtifacts(
        attemptTrialDirectory,
        request,
        extensionVersion,
        { agentTimeoutSec, smokeProtocol }
      );
      if (retryCategories.length > 0) {
        writeHarborRetryMetadata(attemptTrialDirectory, {
          attempt: attempt + 1,
          category: retryCategories.at(
            -1
          ) as HarborInfrastructureFailureCategory,
          failedBeforeAgent: false,
          maxRetries: MAX_HARBOR_INFRA_RETRIES,
          priorFailures: [...retryCategories],
          providerUsageRecorded: false,
          retryScheduled: false,
        });
      }
      process.stdout.write(
        `${ATTESTATION_PREFIX}${JSON.stringify(result.attestation)}\n`
      );
      process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`);
      return result;
    }
  } finally {
    harborTask.cleanup();
  }
  throw new Error("Harbor trial retry loop ended unexpectedly.");
};

export const main = async (argv = process.argv.slice(2)) => {
  const request = parseHarborTrialArgs(argv);
  await runTrial(request);
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Harbor adapter error: ${message}\n`);
    process.exitCode = 1;
  });
}
