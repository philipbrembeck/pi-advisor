/* biome-ignore-all lint/suspicious/noBitwiseOperators: the seeded bootstrap PRNG is a fixed 32-bit recurrence. */
/* biome-ignore-all lint/style/useBlockStatements: the classifier and counter deliberately enumerate mutually exclusive states. */
/* biome-ignore-all lint/style/noNonNullAssertion: the guarded median is known to be present. */
/* biome-ignore-all lint/style/useForOf: indexed resampling intentionally draws by position. */
import type {
  AggregateMetrics,
  BootstrapInterval,
  Distribution,
  RawBenchmarkResult,
} from "./types.js";

export const median = (values: number[]) => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const mean = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
const quantile = (values: number[], q: number) => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))
  ];
};
const distribution = (values: number[]): Distribution => ({
  max: values.length ? Math.max(...values) : null,
  median: median(values),
  p90: quantile(values, 0.9),
});

export const bootstrap = (
  values: number[],
  seed: number,
  drawCount = 10_000
): BootstrapInterval => {
  const estimate = mean(values) ?? 0;
  if (values.length < 2) {
    return { estimate, high: null, insufficient: true, low: null };
  }
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
  const draws: number[] = [];
  for (let draw = 0; draw < drawCount; draw += 1) {
    let total = 0;
    for (let i = 0; i < values.length; i += 1) {
      total += values[Math.floor(random() * values.length)];
    }
    draws.push(total / values.length);
  }
  return {
    estimate,
    high: quantile(draws, 0.975),
    insufficient: false,
    low: quantile(draws, 0.025),
  };
};

export const isSuccessful = (record: RawBenchmarkResult) =>
  record.correct &&
  record.validation.passed &&
  !record.validation.timedOut &&
  record.termination.state === "settled";

const classify = (record: RawBenchmarkResult) => {
  if (isSuccessful(record)) {
    return "success" as const;
  }
  if (record.failureClass) {
    return record.failureClass;
  }
  if (record.validation.timedOut) {
    return "validator-timeout" as const;
  }
  if (record.termination.state === "timeout") {
    return "agent-timeout" as const;
  }
  if (record.termination.state === "provider-error") {
    return "provider-failure" as const;
  }
  if (record.termination.state === "agent-error") {
    return "agent-failure" as const;
  }
  if (record.infrastructureFailure) {
    return "infrastructure-failure" as const;
  }
  return record.validation.failureClass === "validator-timeout"
    ? ("validator-timeout" as const)
    : ("validation-failure" as const);
};

export const aggregate = (
  records: RawBenchmarkResult[],
  frontierMedian?: number | null
): AggregateMetrics => {
  const successes = records.filter(isSuccessful).length;
  const costs = records
    .map((record) => record.totalCost)
    .filter((value): value is number => value !== null);
  const successfulCosts = records
    .filter((record) => isSuccessful(record) && record.totalCost !== null)
    .map((record) => record.totalCost as number);
  const durations = records
    .filter((record) => record.termination.state === "settled")
    .map((record) => record.durationMs)
    .filter((value) => value > 0);
  const usageComplete = costs.length;
  const failures = records.reduce<AggregateMetrics["failures"]>(
    (counts, record) => {
      const failure = classify(record);
      if (failure === "success") {
        counts.success += 1;
      } else if (failure === "agent-failure") {
        counts.agentFailure += 1;
      } else if (failure === "agent-timeout") {
        counts.agentTimeout += 1;
      } else if (failure === "provider-failure") {
        counts.providerFailure += 1;
      } else if (failure === "validator-timeout") {
        counts.validatorTimeout += 1;
      } else if (failure === "validation-failure") {
        counts.validationFailure += 1;
      } else {
        counts.infrastructureFailure += 1;
      }
      return counts;
    },
    {
      agentFailure: 0,
      agentTimeout: 0,
      infrastructureFailure: 0,
      providerFailure: 0,
      success: 0,
      validationFailure: 0,
      validatorTimeout: 0,
    }
  );
  const failureInvariants = records.reduce<Record<string, number>>(
    (counts, { validation: { invariant } }) => {
      if (invariant) {
        counts[invariant] = (counts[invariant] ?? 0) + 1;
      }
      return counts;
    },
    {}
  );
  const completedRuns = failures.success + failures.validationFailure;
  return {
    attempts: records.length,
    completedRuns,
    completedValidationRate: completedRuns ? successes / completedRuns : null,
    correctness: records.length ? successes / records.length : 0,
    correctnessCI: bootstrap(
      records.map((record) => (record.correct ? 1 : 0)),
      1
    ),
    costCI: bootstrap(costs, 2),
    costCoverage: usageComplete,
    costCoveragePercent: records.length ? usageComplete / records.length : 0,
    costPerAttempt: mean(costs),
    costPerSuccess: mean(successfulCosts),
    costPerSuccessCoverage: successfulCosts.length,
    failureInvariants,
    failures,
    meanCost: mean(costs),
    medianDurationMs: median(durations),
    observed: {
      agentTurns: distribution(
        records
          .map((record) => record.trajectory?.agentTurns)
          .filter((value): value is number => value !== undefined)
      ),
      cachedTokens: distribution(
        records
          .map((record) => record.executor.cacheRead)
          .filter((value): value is number => value !== null)
      ),
      inputTokens: distribution(
        records
          .map((record) => record.executor.input)
          .filter((value): value is number => value !== null)
      ),
      modelCalls: distribution(records.map((record) => record.executor.calls)),
      outputTokens: distribution(
        records
          .map((record) => record.executor.output)
          .filter((value): value is number => value !== null)
      ),
      toolCalls: distribution(
        records
          .map((record) => record.trajectory?.toolCalls)
          .filter((value): value is number => value !== undefined)
      ),
    },
    speedIndex:
      frontierMedian && frontierMedian > 0
        ? median(durations)! / frontierMedian
        : null,
    successes,
    timeoutRate: records.length
      ? (failures.agentTimeout + failures.validatorTimeout) / records.length
      : 0,
    usageComplete,
  };
};
