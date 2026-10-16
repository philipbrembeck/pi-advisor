import { formatTokenCount } from "../usage.ts";

export interface AdvisorJevUsageTotals {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  unavailableCostCalls: number;
  knownCostCalls: number;
}

export interface AdvisorJevFilterLedger {
  allowed: number;
  failures: number;
  overrides: number;
  repeatSkipped: number;
  screened: number;
  skipped: number;
}

export interface AdvisorJevGateLedger {
  checks: number;
  consultations: number;
  failures: number;
  usage: AdvisorJevUsageTotals;
}

export interface AdvisorJevLedger {
  filter: AdvisorJevFilterLedger;
  gate: AdvisorJevGateLedger;
  usage: AdvisorJevUsageTotals;
}

export interface AdvisorJevUsage {
  cost?: number;
  inputTokens: number;
  outputTokens: number;
}

export interface JevSkipRecord {
  normalizedQuestion?: string;
  turn: number;
}

/** Invocation fields the Jev summary reads; satisfied by AdvisorInvocationRecord. */
export interface JevInvocationView {
  cost?: number;
  kind: string;
  trigger: string;
}

const freshJevUsage = (): AdvisorJevUsageTotals => ({
  cost: 0,
  inputTokens: 0,
  knownCostCalls: 0,
  outputTokens: 0,
  unavailableCostCalls: 0,
});

const freshJevLedger = (): AdvisorJevLedger => ({
  filter: {
    allowed: 0,
    failures: 0,
    overrides: 0,
    repeatSkipped: 0,
    screened: 0,
    skipped: 0,
  },
  gate: { checks: 0, consultations: 0, failures: 0, usage: freshJevUsage() },
  usage: freshJevUsage(),
});

const addJevUsage = (totals: AdvisorJevUsageTotals, usage: AdvisorJevUsage) => {
  if (usage.cost === undefined) {
    totals.unavailableCostCalls += 1;
  } else {
    totals.cost += usage.cost;
    totals.knownCostCalls += 1;
  }

  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
};

const savingsLine = (costs: number[], skipped: number) => {
  if (costs.length === 0) {
    return "Estimated saving from skips: unavailable — no observed consultation cost this session";
  }

  const mean = costs.reduce((sum, cost) => sum + cost, 0) / costs.length;

  return `Estimated saving from skips: ≤ $${(mean * skipped).toFixed(4)} — upper bound; assumes each skipped consultation would have cost this session's mean allowed-consultation cost ($${mean.toFixed(4)}), which the skipped calls would likely have undercut`;
};

const formatJevTokens = (usage: AdvisorJevUsageTotals) =>
  `↑${formatTokenCount(usage.inputTokens + usage.outputTokens)}`;

const jevCostText = (usage: AdvisorJevUsageTotals) => {
  if (usage.unavailableCostCalls > 0) {
    return usage.knownCostCalls > 0
      ? `cost unavailable (known catalog-priced usage $${usage.cost.toFixed(4)})`
      : "cost unavailable (classifier usage was not reported)";
  }

  return `$${usage.cost.toFixed(4)}`;
};

const markdownCosts = (invocations: readonly JevInvocationView[]): number[] =>
  invocations.flatMap((item) =>
    item.kind === "markdown" && item.cost !== undefined ? [item.cost] : []
  );

const filterLine = (filter: AdvisorJevFilterLedger) => {
  const head = `${filter.screened} screened (${filter.allowed} allowed, ${filter.skipped} skipped${filter.repeatSkipped > 0 ? ` [${filter.repeatSkipped} repeat]` : ""})`;
  const parts = [head];

  if (filter.overrides > 0) {
    parts.push(
      `${filter.overrides} override${filter.overrides === 1 ? "" : "s"}`
    );
  }

  if (filter.failures > 0) {
    parts.push(`${filter.failures} failure${filter.failures === 1 ? "" : "s"}`);
  }

  return `Jev/Decisions filter: ${parts.join(", ")}`;
};

const gateLine = (
  gate: AdvisorJevGateLedger,
  invocations: readonly JevInvocationView[]
) => {
  const consultationCosts = invocations.flatMap((item) =>
    item.trigger === "turn-gate" && item.cost !== undefined ? [item.cost] : []
  );

  const gateSpend = consultationCosts.reduce((sum, cost) => sum + cost, 0);

  return `Turn gate: ${gate.checks} check${gate.checks === 1 ? "" : "s"} (Jev/Decisions ${formatJevTokens(gate.usage)} · ${jevCostText(gate.usage)}), ${gate.consultations} consultation${gate.consultations === 1 ? "" : "s"} ($${gateSpend.toFixed(4)})`;
};

/** One session's Jev screening and turn-gate accounting plus summary lines. */
export class AdvisorJevLedgerState {
  #ledger = freshJevLedger();
  #lastSkip: JevSkipRecord | undefined;

  reset() {
    this.#ledger = freshJevLedger();
    this.#lastSkip = undefined;
  }

  get lastSkip() {
    return this.#lastSkip;
  }

  recordFilterAllowed() {
    this.#ledger.filter.allowed += 1;
    this.#ledger.filter.screened += 1;
  }

  recordFilterSkipped(
    repeat: boolean,
    normalizedQuestion: string | undefined,
    turn: number
  ) {
    this.#ledger.filter.skipped += 1;
    this.#ledger.filter.screened += 1;

    if (repeat) {
      this.#ledger.filter.repeatSkipped += 1;
    }

    const skip: JevSkipRecord = { turn };

    if (normalizedQuestion) {
      skip.normalizedQuestion = normalizedQuestion;
    }

    this.#lastSkip = skip;
  }

  recordFilterOverride() {
    this.#ledger.filter.overrides += 1;
  }

  recordFilterFailure() {
    this.#ledger.filter.failures += 1;
  }

  recordFilterUsage(usage: AdvisorJevUsage) {
    addJevUsage(this.#ledger.usage, usage);
  }

  recordGateCheck(usage?: AdvisorJevUsage) {
    this.#ledger.gate.checks += 1;

    if (usage) {
      addJevUsage(this.#ledger.gate.usage, usage);
    }
  }

  recordGateConsultation() {
    this.#ledger.gate.consultations += 1;
  }

  recordGateFailure() {
    this.#ledger.gate.failures += 1;
  }

  summaryLines(invocations: readonly JevInvocationView[]): string[] {
    const lines: string[] = [];
    const { filter, gate, usage } = this.#ledger;

    const nonRepeatJevActivity =
      filter.allowed +
      (filter.skipped - filter.repeatSkipped) +
      filter.failures;

    if (nonRepeatJevActivity === 0 && filter.repeatSkipped > 0) {
      // Only dedup fired — no Jev call ever happened, so the line must not
      // claim Jev activity.
      const parts = [
        `${filter.repeatSkipped} repeat question${filter.repeatSkipped === 1 ? "" : "s"} skipped, earlier advice reattached`,
      ];

      if (filter.overrides > 0) {
        parts.push(
          `${filter.overrides} override${filter.overrides === 1 ? "" : "s"}`
        );
      }

      lines.push(
        `Consultation dedup: ${parts.join(", ")}`,
        savingsLine(markdownCosts(invocations), filter.skipped)
      );
    } else if (this.#filterActive()) {
      lines.push(filterLine(filter));
      const jevTokens = usage.inputTokens + usage.outputTokens;

      if (jevTokens > 0 || usage.unavailableCostCalls > 0) {
        const cost =
          usage.unavailableCostCalls > 0
            ? jevCostText(usage)
            : `$${usage.cost.toFixed(4)} (catalog-priced input/cache; output free)`;

        lines.push(
          `Jev/Decisions cost: ${formatJevTokens(usage)} tokens · ${cost}`
        );
      }

      if (filter.skipped > 0) {
        lines.push(savingsLine(markdownCosts(invocations), filter.skipped));
      }
    }

    if (gate.checks > 0 || gate.consultations > 0) {
      lines.push(gateLine(gate, invocations));
    }

    return lines;
  }

  #filterActive() {
    const { filter } = this.#ledger;

    return filter.screened > 0 || filter.overrides > 0 || filter.failures > 0;
  }
}
