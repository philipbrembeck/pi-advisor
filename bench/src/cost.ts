import { snapshotAdvisorUsage } from "../../src/usage.js";
import type {
  CostValue,
  ModelRole,
  PricingRates,
  RoleCost,
  UsageSnapshot,
} from "./types.js";
import { UNAVAILABLE } from "./types.js";

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

export const normalizeUsage = (usage: unknown): UsageSnapshot => {
  const snapshot = snapshotAdvisorUsage(usage);
  const input = finite(snapshot?.input);
  const output = finite(snapshot?.output);
  const cacheRead = finite(snapshot?.cacheRead);
  const cacheWrite = finite(snapshot?.cacheWrite);
  const totalTokens = finite(snapshot?.totalTokens);
  return {
    cacheRead,
    cacheWrite,
    input,
    output,
    totalTokens:
      totalTokens ??
      (input !== null &&
      output !== null &&
      cacheRead !== null &&
      cacheWrite !== null
        ? input + output + cacheRead + cacheWrite
        : null),
    usageAvailable:
      input !== null &&
      output !== null &&
      cacheRead !== null &&
      cacheWrite !== null,
  };
};

export const emptyRoleCost = (role: ModelRole, model: string): RoleCost => ({
  calls: 0,
  configuredCost: 0,
  model,
  providerCost: 0,
  role,
  usage: {
    cacheRead: 0,
    cacheWrite: 0,
    input: 0,
    output: 0,
    totalTokens: 0,
    usageAvailable: true,
  },
});

export const unknownCost = (role: ModelRole, model: string): RoleCost => ({
  calls: 0,
  configuredCost: UNAVAILABLE,
  model,
  providerCost: UNAVAILABLE,
  role,
  usage: {
    cacheRead: null,
    cacheWrite: null,
    input: null,
    output: null,
    totalTokens: null,
    usageAvailable: false,
  },
});

export const configuredCost = (
  usage: UsageSnapshot,
  pricing: PricingRates
): CostValue => {
  if (
    !usage.usageAvailable ||
    usage.input === null ||
    usage.output === null ||
    usage.cacheRead === null ||
    usage.cacheWrite === null
  ) {
    return UNAVAILABLE;
  }
  return (
    (usage.input * pricing.inputPerMillion +
      usage.output * pricing.outputPerMillion +
      usage.cacheRead * pricing.cacheReadPerMillion +
      usage.cacheWrite * pricing.cacheWritePerMillion) /
    1_000_000
  );
};

const addNullable = (left: number | null, right: number | null) =>
  left === null || right === null ? null : left + right;

const mergeUsage = (
  left: UsageSnapshot,
  right: UsageSnapshot
): UsageSnapshot => ({
  cacheRead: addNullable(left.cacheRead, right.cacheRead),
  cacheWrite: addNullable(left.cacheWrite, right.cacheWrite),
  input: addNullable(left.input, right.input),
  output: addNullable(left.output, right.output),
  totalTokens: addNullable(left.totalTokens, right.totalTokens),
  usageAvailable: left.usageAvailable && right.usageAvailable,
});

export class CostMeter {
  readonly #roles = new Map<ModelRole, RoleCost>();

  record(
    role: ModelRole,
    model: string,
    usage: unknown,
    pricing: PricingRates,
    providerCost?: unknown
  ) {
    const current = this.#roles.get(role) ?? emptyRoleCost(role, model);
    const nextUsage = normalizeUsage(usage);
    current.calls += 1;
    current.model = model;
    current.usage = mergeUsage(current.usage, nextUsage);
    current.configuredCost = configuredCost(current.usage, pricing);
    const reported =
      finite(providerCost) ?? finite(snapshotAdvisorUsage(usage)?.cost);
    if (current.providerCost === UNAVAILABLE || reported === null) {
      current.providerCost = UNAVAILABLE;
    } else {
      current.providerCost += reported;
    }
    this.#roles.set(role, current);
    return { ...current, usage: { ...current.usage } };
  }

  setInactive(role: ModelRole, model: string) {
    if (!this.#roles.has(role)) {
      this.#roles.set(role, emptyRoleCost(role, model));
    }
  }

  role(role: ModelRole, model: string) {
    return { ...(this.#roles.get(role) ?? emptyRoleCost(role, model)) };
  }

  all() {
    return [...this.#roles.values()].map((role) => ({
      ...role,
      usage: { ...role.usage },
    }));
  }

  totalConfiguredCost(): CostValue {
    const roles = this.all();
    if (roles.some((role) => role.configuredCost === UNAVAILABLE)) {
      return UNAVAILABLE;
    }
    return roles.reduce(
      (total, role) => total + (role.configuredCost as number),
      0
    );
  }

  /** Provider-reported total; unavailable if any recorded call omitted it. */
  totalProviderCost(): CostValue {
    const roles = this.all();
    if (roles.some((role) => role.providerCost === UNAVAILABLE)) {
      return UNAVAILABLE;
    }
    return roles.reduce(
      (total, role) => total + (role.providerCost as number),
      0
    );
  }
}

export const estimateCost = (
  calls: number,
  pricing: PricingRates,
  tokenAssumption: { input: number; output: number }
) =>
  calls > 0
    ? (calls *
        (tokenAssumption.input * pricing.inputPerMillion +
          tokenAssumption.output * pricing.outputPerMillion)) /
      1_000_000
    : 0;

export const formatCost = (value: CostValue) =>
  value === UNAVAILABLE ? UNAVAILABLE : `$${value.toFixed(4)}`;
