import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PINNED_ADVISOR,
  PINNED_ADVISOR_EFFORT,
  PINNED_EXECUTOR,
  PINNED_EXECUTOR_EFFORT,
  PINNED_JUDGE_EFFORT,
} from "./config.js";
import type {
  BenchmarkConfig,
  BenchmarkPins,
  ModelPin,
  RecordedProviderRequest,
} from "./types.js";

const readPackageVersion = (path: string, fallback: string) => {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as {
      version?: unknown;
    };
    return typeof value.version === "string" ? value.version : fallback;
  } catch {
    return fallback;
  }
};

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);

export const currentGitCommit = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
};

export const piVersion = () =>
  readPackageVersion(
    join(
      repositoryRoot,
      "node_modules/@earendil-works/pi-coding-agent/package.json"
    ),
    "unknown"
  );

export const advisorVersion = () =>
  readPackageVersion(join(repositoryRoot, "package.json"), "unknown");

export const hashFixtureText = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export const capturePins = (
  config: BenchmarkConfig,
  fixtureHashes: Record<string, string> = {},
  gateSettings: Record<string, unknown> = {}
): BenchmarkPins => ({
  advisorVersion: advisorVersion(),
  fixtureHashes: { ...fixtureHashes },
  gateSettings: {
    failureModes: [...config.gateFailureModes],
    maxCallsPerSession: 1,
    scoutEnabled: false,
    ...gateSettings,
  },
  modelPins: Object.fromEntries(
    Object.entries(config.modelPins).map(([name, pin]) => [name, { ...pin }])
  ),
  piVersion: piVersion(),
  reactBenchCommit: config.reactBenchCommit,
  reactDoctorVersion: config.reactDoctorVersion,
});

export const modelPinText = (pin: ModelPin) =>
  `${pin.role}=${pin.model}@${pin.effort}`;

const EXPECTED_LIVE_PINS: Record<string, ModelPin> = {
  cheapAdvisor: {
    effort: PINNED_ADVISOR_EFFORT,
    model: PINNED_EXECUTOR,
    role: "advisor",
  },
  decisionAdvisor: {
    effort: PINNED_ADVISOR_EFFORT,
    model: PINNED_ADVISOR,
    role: "advisor",
  },
  executor: {
    effort: PINNED_EXECUTOR_EFFORT,
    model: PINNED_EXECUTOR,
    role: "executor",
  },
  frontier: {
    effort: PINNED_EXECUTOR_EFFORT,
    model: PINNED_ADVISOR,
    role: "executor",
  },
  frontierMedium: {
    effort: PINNED_ADVISOR_EFFORT,
    model: PINNED_ADVISOR,
    role: "executor",
  },
  judge: {
    effort: PINNED_JUDGE_EFFORT,
    model: PINNED_ADVISOR,
    role: "judge",
  },
};

/** Reject a live config that silently changes the preregistered model pair. */
export const assertPinnedLiveModelConfiguration = (config: BenchmarkConfig) => {
  for (const [name, expected] of Object.entries(EXPECTED_LIVE_PINS)) {
    const actual = config.modelPins[name];
    if (
      !actual ||
      actual.role !== expected.role ||
      actual.model !== expected.model ||
      actual.effort !== expected.effort
    ) {
      throw new Error(
        `Live model pin ${name} must remain ${modelPinText(expected)}.`
      );
    }
  }
  return true;
};

const requestModel = (request: RecordedProviderRequest) => {
  if (typeof request.model === "string" && request.model.includes("/")) {
    return request.model;
  }
  if (
    typeof request.provider === "string" &&
    typeof request.model === "string"
  ) {
    return `${request.provider}/${request.model}`;
  }
};

const requestEffort = (request: RecordedProviderRequest) => {
  if (typeof request.effort === "string") {
    return request.effort;
  }
  if (typeof request.reasoning === "string") {
    return request.reasoning;
  }
  if (typeof request.reasoning_effort === "string") {
    return request.reasoning_effort;
  }
  if (typeof request.thinkingLevel === "string") {
    return request.thinkingLevel;
  }
};

/** Fails closed when a provider request does not expose the pinned role/model/effort. */
export const assertRecordedRequestPin = (
  request: RecordedProviderRequest,
  expected: ModelPin
) => {
  const actualModel = requestModel(request);
  const actualEffort = requestEffort(request);
  if (actualModel !== expected.model || actualEffort !== expected.effort) {
    throw new Error(
      `Pinned request mismatch for ${expected.role}: expected ${modelPinText(expected)}, got model=${actualModel ?? "missing"}@${actualEffort ?? "missing"}.`
    );
  }
  return true;
};

export const assertRecordedRequestPins = (
  requests: RecordedProviderRequest[],
  expected: ModelPin
) => {
  if (requests.length === 0) {
    throw new Error(`No recorded provider request for ${expected.role}.`);
  }
  for (const request of requests) {
    assertRecordedRequestPin(request, expected);
  }
  return requests.length;
};

export const normalizeVolatileFields = (
  value: unknown,
  volatileFields: string[]
): unknown => {
  const volatile = new Set(volatileFields);
  const visit = (current: unknown, path: string): unknown => {
    if (volatile.has(path) || volatile.has(path.split(".").at(-1) ?? "")) {
      return "<volatile>";
    }
    if (Array.isArray(current)) {
      return current.map((item, index) => visit(item, `${path}.${index}`));
    }
    if (current && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [
            key,
            visit(item, path ? `${path}.${key}` : key),
          ])
      );
    }
    return current;
  };
  return visit(value, "");
};
