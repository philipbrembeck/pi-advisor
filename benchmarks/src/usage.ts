import type {
  PricingRates,
  RoleName,
  RoleUsage,
  UsageLike,
  UsageSnapshot,
} from "./types.js";

export const unknownUsage = (role: RoleName, model: string): RoleUsage => ({
  cacheRead: null,
  cacheWrite: null,
  calls: 0,
  configuredCost: null,
  input: null,
  invocationStatus: "unknown",
  model,
  output: null,
  providerCost: null,
  role,
  totalTokens: null,
  usageAvailable: false,
});

export const zeroUsage = (role: RoleName, model: string): RoleUsage => ({
  cacheRead: 0,
  cacheWrite: 0,
  calls: 0,
  configuredCost: 0,
  input: 0,
  invocationStatus: "inactive",
  model,
  output: 0,
  providerCost: 0,
  role,
  totalTokens: 0,
  usageAvailable: true,
});

const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
export const normalizeUsage = (usage: unknown): UsageSnapshot => {
  const value = usage as UsageLike | undefined;
  const input = numberOrNull(value?.input);
  const output = numberOrNull(value?.output);
  const cacheRead = numberOrNull(value?.cacheRead);
  const cacheWrite = numberOrNull(value?.cacheWrite);
  const totalTokens = numberOrNull(value?.totalTokens);
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

export const configuredCost = (
  usage: UsageSnapshot,
  pricing: PricingRates
): number | null => {
  if (
    !usage.usageAvailable ||
    usage.input === null ||
    usage.output === null ||
    usage.cacheRead === null ||
    usage.cacheWrite === null
  ) {
    return null;
  }
  return (
    (usage.input * pricing.inputPerMillion +
      usage.output * pricing.outputPerMillion +
      usage.cacheRead * pricing.cacheReadPerMillion +
      usage.cacheWrite * pricing.cacheWritePerMillion) /
    1_000_000
  );
};

export const addUsage = (
  target: RoleUsage,
  usage: unknown,
  providerCost?: unknown,
  pricing?: PricingRates
) => {
  const normalized = normalizeUsage(usage);
  target.calls += 1;
  target.invocationStatus = "observed";
  if (target.calls === 1) {
    target.input = normalized.input;
    target.output = normalized.output;
    target.cacheRead = normalized.cacheRead;
    target.cacheWrite = normalized.cacheWrite;
    target.totalTokens = normalized.totalTokens;
    target.usageAvailable = normalized.usageAvailable;
    target.providerCost =
      typeof providerCost === "number" ? providerCost : null;
    target.configuredCost = pricing
      ? configuredCost(normalized, pricing)
      : null;
    return;
  }
  const fields = [
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "totalTokens",
  ] as const;
  for (const field of fields) {
    target[field] =
      target[field] === null || normalized[field] === null
        ? null
        : target[field] + normalized[field];
  }
  target.usageAvailable = target.usageAvailable && normalized.usageAvailable;
  target.providerCost =
    target.providerCost !== null && typeof providerCost === "number"
      ? target.providerCost + providerCost
      : null;
  const next = pricing
    ? configuredCost(
        normalizeUsage({
          cacheRead: target.cacheRead,
          cacheWrite: target.cacheWrite,
          input: target.input,
          output: target.output,
          totalTokens: target.totalTokens,
        }),
        pricing
      )
    : null;
  target.configuredCost = next;
};

export const roleTotalCost = (roles: RoleUsage[]) =>
  roles.every(
    (role) =>
      role.invocationStatus === "inactive" || role.configuredCost !== null
  )
    ? roles.reduce((sum, role) => sum + (role.configuredCost ?? 0), 0)
    : null;
