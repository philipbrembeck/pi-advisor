import { formatTokenCount } from "../usage.ts";

export interface AdvisorJevUsageTotals {
  cost: number;
  inputTokens: number;
  outputTokens: number;
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
  cost: number;
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
  outputTokens: 0,
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
  totals.cost += usage.cost;
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
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
    this.#lastSkip = {
      ...(normalizedQuestion ? { normalizedQuestion } : {}),
      turn,
    };
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
        this.#savingsLine(this.#markdownCosts(invocations), filter.skipped)
      );
    } else if (this.#filterActive()) {
      lines.push(this.#filterLine(filter));
      const jevTokens = usage.inputTokens + usage.outputTokens;
      if (jevTokens > 0) {
        lines.push(
          `Jev cost: ${this.#formatJevTokens(usage)} tokens · $${usage.cost.toFixed(4)} (input only; output free)`
        );
      }
      if (filter.skipped > 0) {
        lines.push(
          this.#savingsLine(this.#markdownCosts(invocations), filter.skipped)
        );
      }
    }
    if (gate.checks > 0 || gate.consultations > 0) {
      lines.push(this.#gateLine(gate, invocations));
    }
    return lines;
  }

  #filterActive() {
    const { filter } = this.#ledger;
    return filter.screened > 0 || filter.overrides > 0 || filter.failures > 0;
  }

  #savingsLine(markdownCosts: number[], skipped: number) {
    if (markdownCosts.length === 0) {
      return "Estimated saving from skips: unavailable — no observed consultation cost this session";
    }
    const mean =
      markdownCosts.reduce((sum, cost) => sum + cost, 0) / markdownCosts.length;
    return `Estimated saving from skips: ≤ $${(mean * skipped).toFixed(4)} — upper bound; assumes each skipped consultation would have cost this session's mean allowed-consultation cost ($${mean.toFixed(4)}), which the skipped calls would likely have undercut`;
  }

  #gateLine(
    gate: AdvisorJevGateLedger,
    invocations: readonly JevInvocationView[]
  ) {
    const consultationCosts = invocations
      .filter(
        (item): item is JevInvocationView & { cost: number } =>
          item.trigger === "turn-gate" && typeof item.cost === "number"
      )
      .map((item) => item.cost);
    const gateSpend = consultationCosts.reduce((sum, cost) => sum + cost, 0);
    return `Turn gate: ${gate.checks} check${gate.checks === 1 ? "" : "s"} (Jev ${this.#formatJevTokens(gate.usage)} · $${gate.usage.cost.toFixed(4)}), ${gate.consultations} consultation${gate.consultations === 1 ? "" : "s"} ($${gateSpend.toFixed(4)})`;
  }

  #formatJevTokens(usage: AdvisorJevUsageTotals) {
    return `↑${formatTokenCount(usage.inputTokens + usage.outputTokens)}`;
  }

  #markdownCosts(invocations: readonly JevInvocationView[]): number[] {
    return invocations
      .filter(
        (item): item is JevInvocationView & { cost: number } =>
          item.kind === "markdown" && typeof item.cost === "number"
      )
      .map((item) => item.cost);
  }

  #filterLine(filter: AdvisorJevFilterLedger) {
    const head = `${filter.screened} screened (${filter.allowed} allowed, ${filter.skipped} skipped${filter.repeatSkipped > 0 ? ` [${filter.repeatSkipped} repeat]` : ""})`;
    const parts = [head];
    if (filter.overrides > 0) {
      parts.push(
        `${filter.overrides} override${filter.overrides === 1 ? "" : "s"}`
      );
    }
    if (filter.failures > 0) {
      parts.push(
        `${filter.failures} failure${filter.failures === 1 ? "" : "s"}`
      );
    }
    return `Jev filter: ${parts.join(", ")}`;
  }
}
