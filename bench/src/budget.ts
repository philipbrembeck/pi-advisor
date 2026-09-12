import type { BudgetEstimate } from "./types.ts";

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export interface BudgetPlan {
  capUsd: number;
  estimatedUsd: number;
  expectedCalls: number;
  maxCalls: number;
  tokenAssumption: { input: number; output: number };
}

export const validateBudgetPlan = (plan: BudgetPlan): BudgetEstimate => {
  if (
    !Number.isFinite(plan.capUsd) ||
    plan.capUsd <= 0 ||
    !Number.isFinite(plan.estimatedUsd) ||
    plan.estimatedUsd < 0 ||
    !Number.isSafeInteger(plan.expectedCalls) ||
    plan.expectedCalls < 0 ||
    !Number.isSafeInteger(plan.maxCalls) ||
    plan.maxCalls < plan.expectedCalls ||
    !Number.isSafeInteger(plan.tokenAssumption.input) ||
    plan.tokenAssumption.input < 0 ||
    !Number.isSafeInteger(plan.tokenAssumption.output) ||
    plan.tokenAssumption.output < 0
  ) {
    throw new TypeError("Invalid benchmark budget plan.");
  }
  return {
    capUsd: plan.capUsd,
    estimatedUsd: plan.estimatedUsd,
    expectedCalls: plan.expectedCalls,
    maxCalls: plan.maxCalls,
    tokenAssumption: { ...plan.tokenAssumption },
  };
};

/** A reserve-before-request guard; unknown provider usage consumes the reserve. */
export class BudgetGuard {
  readonly #capUsd: number;
  #reservedUsd = 0;
  #calls = 0;

  constructor(capUsd: number) {
    if (!Number.isFinite(capUsd) || capUsd <= 0) {
      throw new TypeError("Budget cap must be a finite positive USD value.");
    }
    this.#capUsd = capUsd;
  }

  get capUsd() {
    return this.#capUsd;
  }

  get calls() {
    return this.#calls;
  }

  get reservedUsd() {
    return this.#reservedUsd;
  }

  remainingUsd() {
    return Math.max(0, this.#capUsd - this.#reservedUsd);
  }

  /** Must be called immediately before a provider request. */
  reserve(estimatedUsd: number) {
    if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0) {
      throw new TypeError(
        "A request estimate must be finite and non-negative."
      );
    }
    if (this.#reservedUsd + estimatedUsd > this.#capUsd + Number.EPSILON) {
      throw new BudgetExceededError(
        `Benchmark budget exceeded before provider request: reserved $${this.#reservedUsd.toFixed(4)}, request estimate $${estimatedUsd.toFixed(4)}, cap $${this.#capUsd.toFixed(4)}.`
      );
    }
    this.#reservedUsd += estimatedUsd;
    this.#calls += 1;
    return estimatedUsd;
  }

  /** Replace a reserve with actual provider cost, if known. */
  settle(reservedUsd: number, actualUsd?: number) {
    if (!Number.isFinite(reservedUsd) || reservedUsd < 0) {
      throw new TypeError("Invalid budget reservation.");
    }
    if (
      actualUsd !== undefined &&
      (!Number.isFinite(actualUsd) || actualUsd < 0)
    ) {
      throw new TypeError(
        "Actual provider cost must be finite and non-negative."
      );
    }
    const delta = actualUsd === undefined ? 0 : actualUsd - reservedUsd;
    if (
      delta > 0 &&
      this.#reservedUsd + delta > this.#capUsd + Number.EPSILON
    ) {
      throw new BudgetExceededError(
        `Provider reported cost above the reserved benchmark budget: total $${(this.#reservedUsd + delta).toFixed(4)}, cap $${this.#capUsd.toFixed(4)}.`
      );
    }
    this.#reservedUsd += delta;
  }

  snapshot(): BudgetEstimate {
    return {
      capUsd: this.#capUsd,
      estimatedUsd: this.#reservedUsd,
      expectedCalls: this.#calls,
      maxCalls: this.#calls,
      tokenAssumption: { input: 0, output: 0 },
    };
  }
}

export const formatBudgetEstimate = (estimate: BudgetEstimate) =>
  `Estimated benchmark spend: $${estimate.estimatedUsd.toFixed(4)} / $${estimate.capUsd.toFixed(4)} cap (${estimate.expectedCalls} expected calls; ${estimate.maxCalls} maximum).`;
