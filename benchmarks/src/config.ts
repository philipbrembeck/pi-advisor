/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: strict benchmark configuration validation is intentionally explicit. */
/* biome-ignore-all lint/style/useDestructuring: validation accesses named schema keys for precise diagnostics. */
/* biome-ignore-all lint/suspicious/noUnnecessaryConditions: runtime JSON values are unknown despite narrowing helpers. */
/* biome-ignore-all lint/style/useDefaultSwitchClause: the mode union is exhaustively checked by TypeScript. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  BenchmarkConfig,
  BenchmarkMode,
  BenchmarkModePolicy,
  PricingRates,
} from "./types.js";
import { ALL_MODES, MODES } from "./types.js";

const positiveInteger = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const nonNegativeNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export const validatePricing = (
  value: unknown,
  path = "pricing"
): Record<string, PricingRates> => {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new TypeError(
      `${path} must contain at least one model pricing entry.`
    );
  }
  for (const [model, rates] of Object.entries(value)) {
    if (!(model.includes("/") && isRecord(rates))) {
      throw new TypeError(
        `${path}.${model} must be a provider/model pricing object.`
      );
    }
    for (const key of [
      "inputPerMillion",
      "outputPerMillion",
      "cacheReadPerMillion",
      "cacheWritePerMillion",
    ]) {
      if (!nonNegativeNumber(rates[key])) {
        throw new TypeError(
          `${path}.${model}.${key} must be a non-negative finite number.`
        );
      }
    }
  }
  return value as Record<string, PricingRates>;
};

export const validateBenchmarkConfig = (value: unknown): BenchmarkConfig => {
  if (!isRecord(value)) {
    throw new TypeError("Benchmark config must be a JSON object.");
  }
  const models = value.models;
  if (!isRecord(models)) {
    throw new TypeError("models is required.");
  }
  for (const alias of ["frontier", "small"]) {
    const entry = models[alias];
    if (
      !isRecord(entry) ||
      typeof entry.ref !== "string" ||
      !entry.ref.includes("/")
    ) {
      throw new TypeError(
        `models.${alias}.ref must be a provider/model string.`
      );
    }
  }
  validatePricing(value.pricing);
  if (!isRecord(value.execution)) {
    throw new TypeError("execution is required.");
  }
  const execution = value.execution;
  for (const key of ["runs", "timeoutSeconds", "agentRetries"]) {
    if (
      !(
        positiveInteger(execution[key]) ||
        (key === "agentRetries" && execution[key] === 0)
      )
    ) {
      throw new TypeError(
        `execution.${key} must be a non-negative integer (runs/timeout must be positive).`
      );
    }
  }
  if (!positiveInteger(execution.seed) && execution.seed !== 0) {
    throw new TypeError("execution.seed must be a non-negative safe integer.");
  }
  if (
    !Array.isArray(execution.tools) ||
    execution.tools.some((tool) => typeof tool !== "string" || !tool)
  ) {
    throw new TypeError("execution.tools must be a non-empty string array.");
  }
  if (typeof execution.compactionEnabled !== "boolean") {
    throw new TypeError("execution.compactionEnabled must be boolean.");
  }
  if (
    execution.temperature !== undefined &&
    !nonNegativeNumber(execution.temperature)
  ) {
    throw new TypeError(
      "execution.temperature must be a non-negative finite number."
    );
  }
  if (
    execution.samplingParams !== undefined &&
    !isRecord(execution.samplingParams)
  ) {
    throw new TypeError("execution.samplingParams must be an object.");
  }
  if (!isRecord(value.output)) {
    throw new TypeError("output is required.");
  }
  for (const key of ["resultsPath", "reportMarkdownPath", "reportJsonPath"]) {
    if (typeof value.output[key] !== "string" || !value.output[key]) {
      throw new TypeError(`output.${key} must be a path.`);
    }
  }
  return value as unknown as BenchmarkConfig;
};

export const loadBenchmarkConfig = (
  path: string
): { config: BenchmarkConfig; hash: string; path: string } => {
  const absolute = resolve(path);
  const text = readFileSync(absolute, "utf8");
  const value: unknown = JSON.parse(text);
  const config = validateBenchmarkConfig(value);
  return {
    config,
    hash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    path: absolute,
  };
};

export const resolveModeModels = (
  config: BenchmarkConfig,
  mode: BenchmarkMode
) => {
  if (!ALL_MODES.includes(mode)) {
    throw new TypeError(`Unknown benchmark mode: ${mode}`);
  }
  const frontier = config.models.frontier.ref;
  const small = config.models.small.ref;
  switch (mode) {
    case "baseline":
    case "sol":
      return { advisor: undefined, executor: frontier, scout: undefined };
    case "small-baseline":
    case "luna":
      return { advisor: undefined, executor: small, scout: undefined };
    case "advisor":
    case "luna-advisor-optional":
    case "luna-advisor-mandatory":
      return { advisor: frontier, executor: small, scout: undefined };
    case "advisor-scout":
    case "luna-advisor-scout":
    case "advisor-guidance":
      return {
        advisor: frontier,
        executor: small,
        scout: mode === "luna-advisor-scout" ? small : undefined,
      };
  }
};

export const modePolicy = (mode: BenchmarkMode): BenchmarkModePolicy => {
  switch (mode) {
    case "baseline":
    case "small-baseline":
    case "sol":
    case "luna":
      return {
        advisorCallPolicy: "none",
        advisorToolAvailable: false,
        advisorTrustPolicy: "current",
        scoutAvailable: false,
      };
    case "luna-advisor-optional":
      return {
        advisorCallPolicy: "optional",
        advisorToolAvailable: true,
        advisorTrustPolicy: "current",
        scoutAvailable: false,
      };
    case "advisor":
    case "advisor-scout":
    case "luna-advisor-mandatory":
    case "luna-advisor-scout":
      return {
        advisorCallPolicy: "mandatory",
        advisorToolAvailable: true,
        advisorTrustPolicy: "current",
        scoutAvailable:
          mode === "advisor-scout" || mode === "luna-advisor-scout",
      };
    case "advisor-guidance":
      return {
        advisorCallPolicy: "mandatory",
        advisorToolAvailable: true,
        advisorTrustPolicy: "guidance",
        scoutAvailable: false,
      };
  }
};

export const defaultModes = () => [...MODES] as BenchmarkMode[];

export const configForOutput = (
  config: BenchmarkConfig,
  baseDir: string
): BenchmarkConfig => ({
  ...config,
  output: {
    reportJsonPath: resolve(baseDir, config.output.reportJsonPath),
    reportMarkdownPath: resolve(baseDir, config.output.reportMarkdownPath),
    resultsPath: resolve(baseDir, config.output.resultsPath),
  },
});
