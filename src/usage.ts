import type { Usage } from "@earendil-works/pi-ai/compat";

import { isNumber, isRecordOf } from "./content-utils.ts";
import type { JsonValue } from "./content-utils.ts";

/** Normalized usage returned by an Advisor or Scout provider response. */
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

/** Extracts provider-agnostic usage fields without trusting provider metadata. */
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

/** Returns the reported provider cost, when the response includes one. */
export const advisorUsageCost = <Input>(usage: Input): number | undefined =>
  snapshotAdvisorUsage(usage)?.cost;

/**
 * Converts supported provider usage to Pi's complete nested-tool usage shape.
 * Missing fields become zero only at this Pi API boundary; absent usage remains
 * undefined so an unavailable request is never presented as a zero-cost call.
 */
export const advisorUsageForPi = <Input>(usage: Input): Usage | undefined => {
  const snapshot = snapshotAdvisorUsage(usage);
  if (!(snapshot && isRecordOf(usage))) {
    return undefined;
  }
  const cost = isRecordOf(usage.cost) ? usage.cost : undefined;
  const input = snapshot.input ?? 0;
  const output = snapshot.output ?? 0;
  const cacheRead = snapshot.cacheRead ?? 0;
  const cacheWrite = snapshot.cacheWrite ?? 0;
  const cacheWrite1h = finite(usage.cacheWrite1h);
  const reasoning = finite(usage.reasoning);
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
  if (cacheWrite1h !== undefined) {
    piUsage.cacheWrite1h = cacheWrite1h;
  }
  if (reasoning !== undefined) {
    piUsage.reasoning = reasoning;
  }
  return piUsage;
};

/** Creates empty totals without treating absent usage as zero usage. */
export const emptyAdvisorUsageTotals = (): AdvisorUsageTotals => ({
  calls: 0,
  costCalls: 0,
  knownCalls: 0,
});

/** Adds one direct Advisor response to session-local usage totals. */
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

const formatTokens = formatTokenCount;

const formatCost = (value: number) => `$${value.toFixed(4)}`;

const formatUsageFields = (usage: AdvisorUsageSnapshot): string | undefined => {
  const tokens = [
    usage.input === undefined ? undefined : `↑${formatTokens(usage.input)}`,
    usage.output === undefined ? undefined : `↓${formatTokens(usage.output)}`,
    usage.cacheRead === undefined
      ? undefined
      : `cr:${formatTokens(usage.cacheRead)}`,
    usage.cacheWrite === undefined
      ? undefined
      : `cw:${formatTokens(usage.cacheWrite)}`,
  ].filter((value): value is string => value !== undefined);
  if (tokens.length === 0 && usage.totalTokens !== undefined) {
    tokens.push(`tokens:${formatTokens(usage.totalTokens)}`);
  }
  if (usage.cost !== undefined) {
    tokens.push(formatCost(usage.cost));
  }
  return tokens.join(" · ") || undefined;
};

export const formatAdvisorUsage = <Input>(usage: Input): string | undefined => {
  const snapshot = snapshotAdvisorUsage(usage);
  return snapshot ? formatUsageFields(snapshot) : undefined;
};

export const formatAdvisorUsageTotals = (
  totals: AdvisorUsageTotals
): string => {
  const usage = formatUsageFields(totals);
  const missing = totals.calls - totals.knownCalls;
  const parts = [
    usage,
    missing > 0 ? `${missing} without usage data` : undefined,
  ];
  return (
    parts.filter((value): value is string => value !== undefined).join(" · ") ||
    "unavailable"
  );
};

export const formatAdvisorUsageStatus = (
  totals: AdvisorUsageTotals
): string | undefined => {
  if (totals.calls === 0) {
    return undefined;
  }
  const label = `Advisor: ${totals.calls} call${totals.calls === 1 ? "" : "s"}`;
  return `${label} · ${formatAdvisorUsageTotals(totals)}`;
};
