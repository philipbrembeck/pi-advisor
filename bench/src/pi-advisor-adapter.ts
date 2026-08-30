import { statSync } from "node:fs";
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

export type AdvisorAdapterMode = "executor" | "advisor";

export interface AdvisorRuntimeAttestation {
  adapter: typeof ADVISOR_ADAPTER_ID;
  advisorCalls: number;
  extension: typeof ADVISOR_EXTENSION_ID;
  extensionVersion: string;
  loaded: true;
  mode: AdvisorAdapterMode;
}

export interface PiAdvisorAdapterPrerequisites {
  credentialEnv: string;
  credentialPresent?: boolean;
  extensionPath: string;
  extensionVersion: string;
  providerBaseUrl: string;
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

const isValidProviderUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Validates the inputs that make an adapter run measure pi-advisor rather than
 * a plain Pi invocation. The credential value is never included in errors or
 * attestation records.
 */
export const assertPiAdvisorPrerequisites = (
  prerequisites: PiAdvisorAdapterPrerequisites,
  env: NodeJS.ProcessEnv = process.env
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
  if (!isValidProviderUrl(prerequisites.providerBaseUrl)) {
    throw new PiAdvisorAdapterUnavailableError(
      "BENCH_BASE_URL must be an http(s) provider endpoint for the Harbor adapter."
    );
  }
  if (!prerequisites.credentialEnv.trim()) {
    throw new PiAdvisorAdapterUnavailableError(
      "A provider credential environment variable is required for Harbor."
    );
  }
  const credentialPresent =
    prerequisites.credentialPresent ??
    Boolean(env[prerequisites.credentialEnv]);
  if (!credentialPresent) {
    throw new PiAdvisorAdapterUnavailableError(
      `${prerequisites.credentialEnv} is not set; refusing to run plain or unauthenticated Pi.`
    );
  }
  return true;
};

const parseAttestationValue = (
  value: unknown,
  expectedVersion: string,
  arm: TrialArm
): AdvisorRuntimeAttestation => {
  if (
    !(
      isRecord(value) &&
      value.adapter === ADVISOR_ADAPTER_ID &&
      value.extension === ADVISOR_EXTENSION_ID &&
      value.loaded === true &&
      typeof value.extensionVersion === "string" &&
      value.extensionVersion === expectedVersion &&
      (value.mode === "executor" || value.mode === "advisor") &&
      value.mode === modeForArm(arm) &&
      typeof value.advisorCalls === "number" &&
      Number.isSafeInteger(value.advisorCalls) &&
      value.advisorCalls >= 0
    )
  ) {
    throw new Error(
      "Harbor adapter must attest that the pinned pi-advisor extension loaded in the expected mode."
    );
  }
  if (arm === "E+A" && value.advisorCalls < 1) {
    throw new Error(
      "Harbor E+A trial must attest at least one Advisor consultation."
    );
  }
  return {
    adapter: ADVISOR_ADAPTER_ID,
    advisorCalls: value.advisorCalls,
    extension: ADVISOR_EXTENSION_ID,
    extensionVersion: value.extensionVersion,
    loaded: true,
    mode: value.mode,
  };
};

export const parseAdvisorAttestation = (
  output: string,
  expectedVersion: string,
  arm: TrialArm
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
  return parseAttestationValue(parsed, expectedVersion, arm);
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

  constructor(options: PiAdvisorHarborAdapterOptions) {
    assertPiAdvisorPrerequisites(options.prerequisites);
    this.#prerequisites = { ...options.prerequisites };
    this.#runner = new CommandReactBenchRunner(options);
  }

  run = async (
    request: ReactBenchTrialRequest
  ): Promise<ReactBenchTrialResult> => {
    const result = await this.#runner.run(request);
    const attestation = parseAttestationValue(
      result.attestation,
      this.#prerequisites.extensionVersion,
      request.arm
    );
    return { ...result, attestation };
  };
}

export const createPiAdvisorHarborAdapter = (
  command?: string,
  env: NodeJS.ProcessEnv = process.env
) => {
  const resolvedCommand =
    command ?? env.BENCH_PI_ADVISOR_ADAPTER ?? env.BENCH_PI_ADAPTER;
  if (!resolvedCommand?.trim()) {
    return;
  }
  const extensionPath = env.BENCH_PI_ADVISOR_EXTENSION;
  const extensionVersion = env.BENCH_PI_ADVISOR_VERSION;
  const providerBaseUrl = env.BENCH_BASE_URL;
  const credentialEnv = env.BENCH_PI_ADVISOR_CREDENTIAL_ENV ?? "BENCH_API_KEY";
  if (!(extensionPath && extensionVersion && providerBaseUrl)) {
    throw new PiAdvisorAdapterUnavailableError(
      "BENCH_PI_ADVISOR_EXTENSION, BENCH_PI_ADVISOR_VERSION, and BENCH_BASE_URL are required for the Advisor Harbor adapter."
    );
  }
  return new PiAdvisorHarborAdapter({
    artifactRoot: "bench/reports/reactbench-trajectories",
    command: resolvedCommand,
    cwd: process.cwd(),
    prerequisites: {
      credentialEnv,
      credentialPresent: Boolean(env[credentialEnv]),
      extensionPath,
      extensionVersion,
      providerBaseUrl,
    },
  });
};
