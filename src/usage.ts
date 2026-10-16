import type { Usage } from "@earendil-works/pi-ai/compat";

import { isNumber, isRecordOf } from "./content-utils.ts";
import type { JsonValue, RecordValue } from "./content-utils.ts";

export interface AdvisorUsageSnapshot {
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  input?: number;
  output?: number;
  totalTokens?: number;
}

export interface AdvisorUsageTotals {
  cacheRead?: number;
  cacheWrite?: number;
  calls: number;
  cost?: number;
  costCalls: number;
  input?: number;
  knownCalls: number;
  output?: number;
  totalTokens?: number;
}

const finite = (value: JsonValue | undefined): number | undefined =>
  isNumber(value) && Number.isFinite(value) && value >= 0 ? value : undefined;

const add = (left: number | undefined, right: number | undefined) =>
  left === undefined || right === undefined ? (left ?? right) : left + right;

const costFields = ["input", "output", "cacheRead", "cacheWrite", "total"];

const hasPartialProviderCost = (
  snapshot: AdvisorUsageSnapshot,
  usage: RecordValue
) => {
  const cost = isRecordOf(usage.cost) ? usage.cost : undefined;

  return (
    cost !== undefined &&
    snapshot.cost === undefined &&
    costFields.some((field) => finite(cost[field]) !== undefined)
  );
};

export const snapshotAdvisorUsage = <Input>(
  usage: Input
): AdvisorUsageSnapshot | undefined => {
  if (!isRecordOf(usage)) {
    return undefined;
  }

  const cost = isRecordOf(usage.cost) ? usage.cost : undefined;

  const snapshot = {
    cacheRead: finite(usage.cacheRead),
    cacheWrite: finite(usage.cacheWrite),
    cost: finite(cost?.total) ?? finite(usage.totalCost) ?? finite(usage.cost),
    input: finite(usage.input),
    output: finite(usage.output),
    totalTokens: finite(usage.totalTokens),
  } satisfies AdvisorUsageSnapshot;

  const hasCostField = costFields.some(
    (field) => finite(cost?.[field]) !== undefined
  );

  return Object.values(snapshot).some((value) => value !== undefined) ||
    hasCostField
    ? snapshot
    : undefined;
};

export const advisorUsageCost = <Input>(usage: Input) =>
  snapshotAdvisorUsage(usage)?.cost;

const completeUsageSnapshot = <Input>(usage: Input) => {
  const snapshot = snapshotAdvisorUsage(usage);

  if (!(snapshot && isRecordOf(usage))) {
    return undefined;
  }

  if (hasPartialProviderCost(snapshot, usage)) {
    return undefined;
  }

  return { snapshot, usage };
};

const cleanUsage = (usage: Usage): Usage => {
  const { cost } = usage;

  const totalTokens =
    usage.input + usage.output + usage.cacheRead + usage.cacheWrite;

  return {
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    cost: {
      cacheRead: cost.cacheRead,
      cacheWrite: cost.cacheWrite,
      input: cost.input,
      output: cost.output,
      total: cost.total,
    },
    input: usage.input,
    output: usage.output,
    totalTokens,
  };
};

export const combineAdvisorAndClassifierUsage = (
  advisor: Usage | undefined,
  classifier: Usage | undefined
): Usage | undefined => {
  if (!(advisor || classifier)) {
    return undefined;
  }

  const left = advisor ? cleanUsage(advisor) : undefined;
  const right = classifier ? cleanUsage(classifier) : undefined;

  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return {
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    cost: {
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      input: left.cost.input + right.cost.input,
      output: left.cost.output,
      total:
        left.cost.total +
        right.cost.input +
        right.cost.cacheRead +
        right.cost.cacheWrite,
    },
    input: left.input + right.input,
    output: left.output + right.output,
    totalTokens: left.totalTokens + right.totalTokens,
  };
};

export const advisorUsageForPi = <Input>(usage: Input): Usage | undefined => {
  const complete = completeUsageSnapshot(usage);

  if (!complete) {
    return undefined;
  }

  const { snapshot } = complete;

  const cost = isRecordOf(complete.usage.cost)
    ? complete.usage.cost
    : undefined;

  const input = snapshot.input ?? 0;
  const output = snapshot.output ?? 0;
  const cacheRead = snapshot.cacheRead ?? 0;
  const cacheWrite = snapshot.cacheWrite ?? 0;

  const piUsage: Usage = {
    cacheRead,
    cacheWrite,
    cost: {
      cacheRead: finite(cost?.cacheRead) ?? 0,
      cacheWrite: finite(cost?.cacheWrite) ?? 0,
      input: finite(cost?.input) ?? 0,
      output: finite(cost?.output) ?? 0,
      total: snapshot.cost ?? 0,
    },
    input,
    output,
    totalTokens:
      snapshot.totalTokens ?? input + output + cacheRead + cacheWrite,
  };

  const cacheWrite1h = finite(complete.usage.cacheWrite1h);
  const reasoning = finite(complete.usage.reasoning);

  if (cacheWrite1h !== undefined) {
    piUsage.cacheWrite1h = cacheWrite1h;
  }

  if (reasoning !== undefined) {
    piUsage.reasoning = reasoning;
  }

  return piUsage;
};

export const emptyAdvisorUsageTotals = (): AdvisorUsageTotals => ({
  calls: 0,
  costCalls: 0,
  knownCalls: 0,
});

export const addAdvisorUsage = <Input>(
  totals: AdvisorUsageTotals,
  usage: Input
) => {
  totals.calls += 1;
  const snapshot = snapshotAdvisorUsage(usage);

  if (!snapshot) {
    return;
  }

  totals.knownCalls += 1;
  totals.cacheRead = add(totals.cacheRead, snapshot.cacheRead);
  totals.cacheWrite = add(totals.cacheWrite, snapshot.cacheWrite);
  totals.input = add(totals.input, snapshot.input);
  totals.output = add(totals.output, snapshot.output);
  totals.totalTokens = add(totals.totalTokens, snapshot.totalTokens);

  if (snapshot.cost !== undefined) {
    totals.cost = add(totals.cost, snapshot.cost);
    totals.costCalls += 1;
  }
};

export const formatTokenCount = (value: number) => {
  if (value < 1000) {
    return String(value);
  }

  if (value < 10_000) {
    return `${(value / 1000).toFixed(1)}k`;
  }

  if (value < 1_000_000) {
    return `${Math.round(value / 1000)}k`;
  }

  if (value < 10_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  return `${Math.round(value / 1_000_000)}M`;
};

const formatCost = (value: number) => `$${value.toFixed(4)}`;

const formatUsageFields = (usage: AdvisorUsageSnapshot): string | undefined => {
  const tokens = [
    usage.input === undefined ? undefined : `↑${formatTokenCount(usage.input)}`,
    usage.output === undefined
      ? undefined
      : `↓${formatTokenCount(usage.output)}`,
    usage.cacheRead === undefined
      ? undefined
      : `cr:${formatTokenCount(usage.cacheRead)}`,
    usage.cacheWrite === undefined
      ? undefined
      : `cw:${formatTokenCount(usage.cacheWrite)}`,
  ].filter((value): value is string => value !== undefined);

  if (tokens.length === 0 && usage.totalTokens !== undefined) {
    tokens.push(`tokens:${formatTokenCount(usage.totalTokens)}`);
  }

  if (usage.cost !== undefined) {
    tokens.push(formatCost(usage.cost));
  }

  return tokens.join(" · ") || undefined;
};

export const formatAdvisorUsage = <Input>(usage: Input) => {
  const snapshot = snapshotAdvisorUsage(usage);

  return snapshot ? formatUsageFields(snapshot) : undefined;
};

export const formatAdvisorUsageTotals = (totals: AdvisorUsageTotals) => {
  const usage = formatUsageFields(totals);
  const missing = totals.calls - totals.knownCalls;

  return (
    [usage, missing > 0 ? `${missing} without usage data` : undefined]
      .filter((value): value is string => value !== undefined)
      .join(" · ") || "unavailable"
  );
};

export const formatAdvisorUsageStatus = (totals: AdvisorUsageTotals) => {
  if (totals.calls === 0) {
    return undefined;
  }

  return `Advisor: ${totals.calls} call${totals.calls === 1 ? "" : "s"} · ${formatAdvisorUsageTotals(totals)}`;
};
