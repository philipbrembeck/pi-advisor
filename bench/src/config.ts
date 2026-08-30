import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GATE_FAILURE_MODES } from "./gates.js";
import type {
  ArmName,
  BenchmarkConfig,
  GateFailureMode,
  ModelPin,
  ModelRole,
  PricingRates,
} from "./types.js";

export const PINNED_EXECUTOR = "openai-codex/gpt-5.6-luna";
export const PINNED_ADVISOR = "openai-codex/gpt-5.6-sol";
export const PINNED_EXECUTOR_EFFORT = "max";
export const PINNED_ADVISOR_EFFORT = "medium";
export const PINNED_JUDGE_EFFORT = "medium";
export const DEFAULT_REACT_BENCH_COMMIT =
  "11ff042e60ec83a613053fbd721a54ed4dbfdf6f";

export const DEFAULT_PRICING: Record<string, PricingRates> = {
  [PINNED_EXECUTOR]: {
    cacheReadPerMillion: 0,
    cacheWritePerMillion: 0,
    inputPerMillion: 0,
    outputPerMillion: 0,
  },
  [PINNED_ADVISOR]: {
    cacheReadPerMillion: 0,
    cacheWritePerMillion: 0,
    inputPerMillion: 0,
    outputPerMillion: 0,
  },
};

export const DEFAULT_MODEL_PINS: Record<string, ModelPin> = {
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
    effort: "max",
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

export const DEFAULT_CONFIG: BenchmarkConfig = {
  budgetUsd: 10,
  fixtureRoot: "bench/fixtures",
  gateFailureModes: [...GATE_FAILURE_MODES],
  modelPins: DEFAULT_MODEL_PINS,
  pricing: DEFAULT_PRICING,
  reactBenchCommit: DEFAULT_REACT_BENCH_COMMIT,
  reactDoctorVersion: "pinned-by-reactbench",
  reportRoot: "bench/reports",
  seed: 1,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isPositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && typeof value === "number" && value > 0;
const isModelRef = (value: unknown): value is string =>
  typeof value === "string" && value.includes("/") && value.trim().length > 2;
const isRole = (value: unknown): value is ModelRole =>
  value === "executor" || value === "advisor" || value === "judge";

export const validatePricing = (
  value: unknown,
  path = "pricing"
): Record<string, PricingRates> => {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new TypeError(`${path} must contain at least one model.`);
  }
  const result: Record<string, PricingRates> = {};
  for (const [model, raw] of Object.entries(value)) {
    if (!(isModelRef(model) && isRecord(raw))) {
      throw new TypeError(`${path}.${model} must be a provider/model object.`);
    }
    const keys = [
      "inputPerMillion",
      "outputPerMillion",
      "cacheReadPerMillion",
      "cacheWritePerMillion",
    ] as const;
    const rates = keys.map((key) => {
      const rate = raw[key];
      if (!isFiniteNonNegative(rate)) {
        throw new TypeError(
          `${path}.${model}.${key} must be a finite non-negative number.`
        );
      }
      return rate;
    });
    result[model] = {
      cacheReadPerMillion: rates[2],
      cacheWritePerMillion: rates[3],
      inputPerMillion: rates[0],
      outputPerMillion: rates[1],
    };
  }
  return result;
};

const validateModelPins = (value: unknown): Record<string, ModelPin> => {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new TypeError("modelPins must contain at least one model pin.");
  }
  const result: Record<string, ModelPin> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (
      !(isRecord(raw) && isModelRef(raw.model)) ||
      typeof raw.effort !== "string" ||
      !raw.effort.trim() ||
      !isRole(raw.role)
    ) {
      throw new TypeError(
        `modelPins.${name} must contain model, effort, and a valid role.`
      );
    }
    result[name] = {
      effort: raw.effort,
      model: raw.model,
      role: raw.role,
    };
  }
  return result;
};

export const validateBenchmarkConfig = (value: unknown): BenchmarkConfig => {
  if (!isRecord(value)) {
    throw new TypeError("Benchmark config must be an object.");
  }
  if (!isFiniteNonNegative(value.budgetUsd) || value.budgetUsd <= 0) {
    throw new TypeError("budgetUsd must be a finite positive number.");
  }
  const pricing = validatePricing(value.pricing);
  if (typeof value.fixtureRoot !== "string" || !value.fixtureRoot) {
    throw new TypeError("fixtureRoot must be a path.");
  }
  if (typeof value.reportRoot !== "string" || !value.reportRoot) {
    throw new TypeError("reportRoot must be a path.");
  }
  if (
    typeof value.seed !== "number" ||
    !Number.isSafeInteger(value.seed) ||
    value.seed < 0
  ) {
    throw new TypeError("seed must be a non-negative safe integer.");
  }
  if (!Array.isArray(value.gateFailureModes)) {
    throw new TypeError("gateFailureModes must be an array.");
  }
  for (const mode of value.gateFailureModes) {
    if (!GATE_FAILURE_MODES.includes(mode as GateFailureMode)) {
      throw new TypeError(`Unknown gate failure mode: ${String(mode)}`);
    }
  }
  if (value.gateFailureModes.length !== GATE_FAILURE_MODES.length) {
    throw new TypeError("gateFailureModes must cover all three failure modes.");
  }
  const modelPins = validateModelPins(value.modelPins);
  if (typeof value.reactBenchCommit !== "string" || !value.reactBenchCommit) {
    throw new TypeError("reactBenchCommit must be recorded.");
  }
  if (
    typeof value.reactDoctorVersion !== "string" ||
    !value.reactDoctorVersion
  ) {
    throw new TypeError("reactDoctorVersion must be recorded.");
  }
  return {
    budgetUsd: value.budgetUsd,
    fixtureRoot: value.fixtureRoot,
    gateFailureModes: [...value.gateFailureModes] as GateFailureMode[],
    modelPins,
    pricing,
    reactBenchCommit: value.reactBenchCommit,
    reactDoctorVersion: value.reactDoctorVersion,
    reportRoot: value.reportRoot,
    seed: value.seed,
  };
};

export const loadBenchmarkConfig = (
  path?: string
): { config: BenchmarkConfig; hash: string; path?: string } => {
  if (!path) {
    const text = JSON.stringify(DEFAULT_CONFIG);
    return {
      config: validateBenchmarkConfig(JSON.parse(text)),
      hash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    };
  }
  const absolute = resolve(path);
  const text = readFileSync(absolute, "utf8");
  const parsed: unknown = JSON.parse(text);
  return {
    config: validateBenchmarkConfig(parsed),
    hash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    path: absolute,
  };
};

export const modelPin = (
  config: BenchmarkConfig,
  name: string,
  role: ModelRole
): ModelPin => {
  const pin = config.modelPins[name];
  if (!pin) {
    throw new Error(`Missing ${name} model pin.`);
  }
  if (pin.role !== role) {
    throw new Error(
      `Model pin ${name} has role ${pin.role}, expected ${role}.`
    );
  }
  return pin;
};

export const armModelPins = (
  config: BenchmarkConfig,
  arm: ArmName
): { advisor?: ModelPin; executor: ModelPin; judge: ModelPin } => {
  const executor = modelPin(config, "executor", "executor");
  const judge = modelPin(config, "judge", "judge");
  if (arm === "cheap") {
    return {
      advisor: modelPin(config, "cheapAdvisor", "advisor"),
      executor,
      judge,
    };
  }
  if (arm === "frontier" || arm === "E+A") {
    return {
      advisor: modelPin(config, "decisionAdvisor", "advisor"),
      executor,
      judge,
    };
  }
  if (arm === "F") {
    return { executor: modelPin(config, "frontier", "executor"), judge };
  }
  if (arm === "F′") {
    return { executor: modelPin(config, "frontierMedium", "executor"), judge };
  }
  return { executor, judge };
};

export const configHash = (config: BenchmarkConfig) =>
  `sha256:${createHash("sha256").update(JSON.stringify(config)).digest("hex")}`;

export const defaultPricingFor = (
  config: BenchmarkConfig,
  model: string
): PricingRates | undefined => config.pricing[model];

export const positiveInteger = isPositiveInteger;
