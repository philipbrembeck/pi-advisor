import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { normalizeUsage } from "./cost.js";
import {
  DEFAULT_HARBOR_AGENT_TIMEOUT_SEC,
  harborCommandTimeoutMs,
  parseHarborAgentTimeout,
} from "./harbor-timeout.js";
import { PI_ADVISOR_VERSION } from "./package-version.js";
import type {
  CommandReactBenchRunnerOptions,
  ReactBenchTrialRequest,
  ReactBenchTrialResult,
  TrialArm,
} from "./reactbench.js";
import { CommandReactBenchRunner } from "./reactbench.js";

export const ADVISOR_ATTESTATION_PREFIX = "BENCH_ADVISOR_ATTESTATION=";
export const ADVISOR_ADAPTER_ID = "pi-advisor-harbor";
export const ADVISOR_EXTENSION_ID = "pi-advisor-flow";

const LINE_BREAK = /\r?\n/;
const DEFAULT_EXTENSION_PATH = resolve(process.cwd(), "extensions/index.ts");
const DEFAULT_COMMAND = resolve(process.cwd(), "bench/harbor/run-trial");
const DEFAULT_EXTENSION_VERSION = PI_ADVISOR_VERSION;
const DEFAULT_PI_VERSION = "0.84.4";

export type AdvisorAdapterMode = "executor" | "advisor";

export interface AdvisorRuntimeAttestation {
  adapter: typeof ADVISOR_ADAPTER_ID;
  advisorCalls: number;
  extension: typeof ADVISOR_EXTENSION_ID;
  extensionVersion: string;
  loaded: true;
  mode: AdvisorAdapterMode;
  shutdown: true;
  smokeProtocol: boolean;
}

export interface PiAdvisorAdapterPrerequisites {
  authFile: string;
  authPresent?: boolean;
  extensionPath: string;
  extensionVersion: string;
  piVersion: string;
}

export class PiAdvisorAdapterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiAdvisorAdapterUnavailableError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const modeForArm = (arm: TrialArm): AdvisorAdapterMode =>
  arm === "E+A" ? "advisor" : "executor";

const isRegularFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const isUsableCodexAuthFile = (path: string) => {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(value)) {
      return false;
    }
    const credential = value["openai-codex"];
    return Boolean(
      isRecord(credential) &&
        credential.type === "oauth" &&
        typeof credential.access === "string" &&
        credential.access.trim() &&
        typeof credential.refresh === "string" &&
        credential.refresh.trim() &&
        typeof credential.expires === "number" &&
        Number.isFinite(credential.expires)
    );
  } catch {
    return false;
  }
};

/**
 * Validates the inputs that make an adapter run measure pi-advisor rather than
 * a plain Pi invocation. OAuth values are never included in errors or
 * attestation records; the host broker performs the live refresh/preflight.
 */
export const assertPiAdvisorPrerequisites = (
  prerequisites: PiAdvisorAdapterPrerequisites
) => {
  if (!prerequisites.extensionPath.trim()) {
    throw new PiAdvisorAdapterUnavailableError(
      "BENCH_PI_ADVISOR_EXTENSION must point to the pinned extension entrypoint."
    );
  }
  if (!isRegularFile(prerequisites.extensionPath)) {
    throw new PiAdvisorAdapterUnavailableError(
      `Pinned Advisor extension entrypoint is missing: ${prerequisites.extensionPath}`
    );
  }
  if (!prerequisites.extensionVersion.trim()) {
    throw new PiAdvisorAdapterUnavailableError(
      "BENCH_PI_ADVISOR_VERSION must identify the pinned Advisor extension."
    );
  }
  if (!prerequisites.piVersion.trim()) {
    throw new PiAdvisorAdapterUnavailableError(
      "BENCH_PI_VERSION must identify the pinned Pi package."
    );
  }
  if (!prerequisites.authFile.trim()) {
    throw new PiAdvisorAdapterUnavailableError(
      "BENCH_PI_ADVISOR_AUTH_FILE must point to the Pi auth.json file."
    );
  }
  const authPresent =
    prerequisites.authPresent ?? isUsableCodexAuthFile(prerequisites.authFile);
  if (!authPresent) {
    throw new PiAdvisorAdapterUnavailableError(
      `Pi auth.json has no usable openai-codex OAuth session: ${prerequisites.authFile}`
    );
  }
  return true;
};

const assertRuntimeArtifacts = (result: ReactBenchTrialResult) => {
  if (
    typeof result.trajectoryPath !== "string" ||
    !result.trajectoryPath.trim()
  ) {
    throw new Error(
      "Harbor adapter result must identify its archived trajectory."
    );
  }
  const { trajectoryPath } = result;
  if (!(existsSync(trajectoryPath) && statSync(trajectoryPath).isDirectory())) {
    throw new Error(
      `Harbor trajectory directory is missing: ${trajectoryPath}`
    );
  }
  const artifactFile = (relativePath: string) => {
    const direct = join(trajectoryPath, relativePath);
    if (existsSync(direct) && statSync(direct).isFile()) {
      return direct;
    }
    const steps = join(trajectoryPath, "steps");
    if (!(existsSync(steps) && statSync(steps).isDirectory())) {
      return;
    }
    const matches = readdirSync(steps)
      .map((step) => join(steps, step, relativePath))
      .filter((path) => existsSync(path) && statSync(path).isFile());
    return matches.length === 1 ? matches[0] : undefined;
  };
  const requiredFiles = [
    "agent/pi.txt",
    "agent/bench-records.jsonl",
    "agent/bench-attestation.json",
    "verifier/reward.json",
  ];
  if (requiredFiles.some((file) => !artifactFile(file))) {
    throw new Error(
      "Harbor adapter trajectory is missing a session, request/usage, attestation, or grader artifact."
    );
  }
  const { usage } = result;
  if (!usage) {
    throw new Error("Harbor adapter result must include usage aggregates.");
  }
  if (
    !(
      isRecord(usage) &&
      isRecord(usage.executor) &&
      isRecord(usage.advisor) &&
      usage.executor.usageAvailable === true &&
      usage.advisor.usageAvailable === true
    )
  ) {
    throw new Error(
      "Harbor adapter result contains unavailable or malformed usage aggregates."
    );
  }
  if (!result.requests?.length) {
    throw new Error("Harbor adapter result must include provider requests.");
  }
  if (
    result.requests.some(
      (request) =>
        !Object.hasOwn(request, "usage") ||
        request.usage === undefined ||
        !normalizeUsage(request.usage).usageAvailable
    )
  ) {
    throw new Error(
      "Harbor adapter result contains a missing or malformed request usage artifact."
    );
  }
  const rewardPath = artifactFile("verifier/reward.json");
  if (!rewardPath) {
    throw new Error("Harbor grader reward artifact is missing.");
  }
  let reward: unknown;
  try {
    reward = JSON.parse(readFileSync(rewardPath, "utf8"));
  } catch (error) {
    throw new TypeError("Harbor grader reward is not valid JSON.", {
      cause: error,
    });
  }
  if (
    !isRecord(reward) ||
    (reward.reward !== 0 && reward.reward !== 1) ||
    result.passed !== (reward.reward === 1)
  ) {
    throw new Error("Harbor result does not agree with its grader reward.");
  }
};

const parseAttestationValue = (
  value: unknown,
  expectedVersion: string,
  arm: TrialArm,
  smokeProtocol = false
): AdvisorRuntimeAttestation => {
  const expectedSmoke = arm === "E+A" && smokeProtocol;
  const hasValidAdvisorCalls = (
    candidate: Record<string, unknown>
  ): candidate is Record<string, unknown> & { advisorCalls: number } =>
    typeof candidate.advisorCalls === "number" &&
    Number.isSafeInteger(candidate.advisorCalls) &&
    candidate.advisorCalls >= 0 &&
    (arm === "E+A"
      ? candidate.advisorCalls <= 1 &&
        (!expectedSmoke || candidate.advisorCalls === 1)
      : candidate.advisorCalls === 0);
  if (
    !(
      isRecord(value) &&
      value.adapter === ADVISOR_ADAPTER_ID &&
      value.extension === ADVISOR_EXTENSION_ID &&
      value.loaded === true &&
      value.shutdown === true &&
      typeof value.extensionVersion === "string" &&
      value.extensionVersion === expectedVersion &&
      (value.mode === "executor" || value.mode === "advisor") &&
      value.mode === modeForArm(arm) &&
      value.smokeProtocol === expectedSmoke &&
      hasValidAdvisorCalls(value)
    )
  ) {
    throw new Error(
      "Harbor adapter must attest that the pinned pi-advisor extension loaded, shut down cleanly, and stayed within the pinned consultation budget."
    );
  }
  return {
    adapter: ADVISOR_ADAPTER_ID,
    advisorCalls: value.advisorCalls,
    extension: ADVISOR_EXTENSION_ID,
    extensionVersion: value.extensionVersion,
    loaded: true,
    mode: value.mode,
    shutdown: true,
    smokeProtocol: expectedSmoke,
  };
};

export const parseAdvisorAttestation = (
  output: string,
  expectedVersion: string,
  arm: TrialArm,
  smokeProtocol = false
): AdvisorRuntimeAttestation => {
  const line = output
    .split(LINE_BREAK)
    .map((value) => value.trim())
    .reverse()
    .find((value) => value.startsWith(ADVISOR_ATTESTATION_PREFIX));
  if (!line) {
    throw new Error(
      `${ADVISOR_ATTESTATION_PREFIX}<json> is required; plain Pi output is not a benchmark result.`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(ADVISOR_ATTESTATION_PREFIX.length));
  } catch (error) {
    throw new TypeError("Harbor adapter emitted invalid Advisor attestation.", {
      cause: error,
    });
  }
  return parseAttestationValue(parsed, expectedVersion, arm, smokeProtocol);
};

export interface PiAdvisorHarborAdapterOptions
  extends Omit<CommandReactBenchRunnerOptions, "command"> {
  command: string;
  prerequisites: PiAdvisorAdapterPrerequisites;
}

/**
 * Fail-closed transport boundary for a real Harbor adapter command. The
 * command remains responsible for starting Harbor and emitting BENCH_RESULT;
 * this class rejects results that do not prove the Advisor extension loaded.
 */
export class PiAdvisorHarborAdapter {
  readonly #prerequisites: PiAdvisorAdapterPrerequisites;
  readonly #runner: CommandReactBenchRunner;
  readonly #smokeProtocol: boolean;

  constructor(options: PiAdvisorHarborAdapterOptions) {
    assertPiAdvisorPrerequisites(options.prerequisites);
    this.#prerequisites = { ...options.prerequisites };
    this.#smokeProtocol = options.smokeProtocol === true;
    this.#runner = new CommandReactBenchRunner({
      ...options,
      timeoutMs:
        options.timeoutMs ??
        harborCommandTimeoutMs(DEFAULT_HARBOR_AGENT_TIMEOUT_SEC),
    });
  }

  run = async (
    request: ReactBenchTrialRequest
  ): Promise<ReactBenchTrialResult> => {
    const result = await this.#runner.run(request);
    const attestation = parseAttestationValue(
      result.attestation,
      this.#prerequisites.extensionVersion,
      request.arm,
      this.#smokeProtocol
    );
    const maxConsultations = request.arm === "E+A" ? 1 : 0;
    if (result.consultations > maxConsultations) {
      throw new Error(
        `Harbor result consultations exceed the pinned session budget (${maxConsultations}).`
      );
    }
    if (attestation.advisorCalls !== result.consultations) {
      throw new Error(
        "Harbor attestation consultation count does not match the result."
      );
    }
    assertRuntimeArtifacts(result);
    return { ...result, attestation };
  };
}

export const createPiAdvisorHarborAdapter = (
  command?: string,
  env: NodeJS.ProcessEnv = process.env
) => {
  const configuredCommand =
    command ?? env.BENCH_PI_ADVISOR_ADAPTER ?? env.BENCH_PI_ADAPTER;
  const resolvedCommand =
    configuredCommand?.trim() ||
    (existsSync(DEFAULT_COMMAND) ? DEFAULT_COMMAND : undefined);
  if (!resolvedCommand) {
    return;
  }
  const extensionPath =
    env.BENCH_PI_ADVISOR_EXTENSION ?? DEFAULT_EXTENSION_PATH;
  const extensionVersion =
    env.BENCH_PI_ADVISOR_VERSION ?? DEFAULT_EXTENSION_VERSION;
  const piVersion = env.BENCH_PI_VERSION ?? DEFAULT_PI_VERSION;
  const authFile = resolve(
    env.BENCH_PI_ADVISOR_AUTH_FILE ??
      join(homedir(), ".pi", "agent", "auth.json")
  );
  return new PiAdvisorHarborAdapter({
    artifactRoot: "bench/reports/reactbench-trajectories",
    command: resolvedCommand,
    cwd: process.cwd(),
    prerequisites: {
      authFile,
      authPresent: isUsableCodexAuthFile(authFile),
      extensionPath,
      extensionVersion,
      piVersion,
    },
    smokeProtocol: env.BENCH_SMOKE === "1",
    timeoutMs: harborCommandTimeoutMs(
      parseHarborAgentTimeout(env.BENCH_HARBOR_AGENT_TIMEOUT_SEC)
    ),
  });
};
