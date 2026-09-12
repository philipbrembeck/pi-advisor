import {
  type AdvisorUsageTotals,
  addAdvisorUsage,
  emptyAdvisorUsageTotals,
  formatAdvisorUsageStatus,
  formatAdvisorUsageTotals,
} from "./usage.ts";

export type GateDecision = "proceed" | "revise" | "blocked";
export type ConsultationTrigger = "manual" | "executor-requested";
export type GateTrigger =
  | "repeated-tool-call"
  | "completion-review"
  | "custom-rule";
type AdvisorTrigger = ConsultationTrigger | GateTrigger;
type ExecutionEffect = "continued" | "tool-blocked" | "session-blocked";

export interface AdvisorInvocationRecord {
  cost?: number;
  decision?: GateDecision;
  executionEffect: ExecutionEffect;
  failure?: string;
  kind: "markdown" | "gate";
  model: string;
  trigger: AdvisorTrigger;
  usage?: unknown;
}

const WHITESPACE = /\s/;
const TIMESTAMP_KEYS = new Set([
  "createdat",
  "date",
  "datetime",
  "time",
  "timestamp",
  "updatedat",
]);
const REQUEST_ID_KEYS = new Set(["correlationid", "requestid", "traceid"]);
const normalizedKey = (key: string) => key.replace(/[-_]/g, "").toLowerCase();
const isVolatileKey = (key: string, keys: Set<string>) =>
  keys.has(normalizedKey(key));

const normalizeShellWhitespace = (command: string) => {
  let result = "";
  let quote: "'" | '"' | "`" | undefined;
  let pendingSpace = false;
  for (const char of command.trim()) {
    if (quote) {
      result += char;
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      if (pendingSpace && result) {
        result += " ";
      }
      pendingSpace = false;
      quote = char;
      result += char;
    } else if (WHITESPACE.test(char)) {
      pendingSpace = true;
    } else {
      if (pendingSpace && result) {
        result += " ";
      }
      pendingSpace = false;
      result += char;
    }
  }
  return result;
};

const normalizeString = (value: string) =>
  value
    .replace(/\/(?:private\/)?tmp\/[^\s/]+/g, "/tmp/<temporary>")
    .replace(/\/var\/folders\/[^\s/]+/g, "/var/folders/<temporary>");

export const normalizeToolInput = (
  toolName: string,
  input: unknown
): unknown => {
  const visit = (value: unknown, key?: string): unknown => {
    if (typeof value === "string") {
      if (key && isVolatileKey(key, TIMESTAMP_KEYS)) {
        return "<timestamp>";
      }
      if (key && isVolatileKey(key, REQUEST_ID_KEYS)) {
        return "<request-id>";
      }
      const normalized = normalizeString(value);
      return toolName === "bash" && key === "command"
        ? normalizeShellWhitespace(normalized)
        : normalized;
    }
    if (Array.isArray(value)) {
      return value.map((item) => visit(item));
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((childKey) => [childKey, visit(record[childKey], childKey)])
      );
    }
    return value;
  };
  return visit(input);
};

export const normalizedToolSignature = (toolName: string, input: unknown) =>
  `${toolName}:${JSON.stringify(normalizeToolInput(toolName, input))}`;

interface RepetitionState {
  count: number;
  interventions: number;
  previousSignature?: string;
}

interface AdviceLedger {
  draftConsultations: number;
  issued: Map<string, { advice: string; trigger: ConsultationTrigger }>;
  lastAdvice?: string;
  outcomes: number;
  pending: Set<string>;
  reported: Set<string>;
}

interface UsageState {
  invocations: AdvisorInvocationRecord[];
  totals: AdvisorUsageTotals;
}

const freshRepetition = (): RepetitionState => ({
  count: 0,
  interventions: 0,
});
const freshAdviceLedger = (): AdviceLedger => ({
  draftConsultations: 0,
  issued: new Map(),
  outcomes: 0,
  pending: new Set(),
  reported: new Set(),
});
const freshUsage = (): UsageState => ({
  invocations: [],
  totals: emptyAdvisorUsageTotals(),
});

export class AdvisorSessionState {
  #repetition = freshRepetition();
  #blockedReason?: string;
  #ledger = freshAdviceLedger();
  #usage = freshUsage();
  #consumedCalls = 0;

  resetTask() {
    this.#repetition = freshRepetition();
    this.#blockedReason = undefined;
    this.#ledger = freshAdviceLedger();
    this.#usage = freshUsage();
    this.#consumedCalls = 0;
  }

  clearBlocked() {
    this.#blockedReason = undefined;
  }
  resetRepetition() {
    // Cumulative interventions feed the session summary and must survive this reset.
    this.#repetition.count = 0;
    this.#repetition.previousSignature = undefined;
  }
  get blocked() {
    return this.#blockedReason !== undefined;
  }
  get blockedReason() {
    return this.#blockedReason;
  }
  block(reason: string) {
    this.#blockedReason ??= reason;
  }

  recordToolCall(toolName: string, input: unknown, threshold: number) {
    if (toolName === "ask_advisor") {
      return false;
    }
    const signature = normalizedToolSignature(toolName, input);
    this.#repetition.count =
      signature === this.#repetition.previousSignature
        ? this.#repetition.count + 1
        : 1;
    this.#repetition.previousSignature = signature;
    if (this.#repetition.count < threshold) {
      return false;
    }
    this.#repetition.interventions += 1;
    return true;
  }

  canConsult(limit: number | undefined) {
    return limit === undefined || this.#consumedCalls < limit;
  }
  consumeCall() {
    this.#consumedCalls += 1;
  }
  remainingCalls(limit: number | undefined) {
    return limit === undefined
      ? undefined
      : Math.max(0, limit - this.#consumedCalls);
  }
  get consumedCalls() {
    return this.#consumedCalls;
  }

  /** Returns a copy of cumulative direct Advisor usage for this session. */
  get usageTotals(): AdvisorUsageTotals {
    return { ...this.#usage.totals };
  }

  /** Returns the footer-ready direct Advisor usage status for this session. */
  usageStatus() {
    return formatAdvisorUsageStatus(this.#usage.totals);
  }

  recordInvocation(record: AdvisorInvocationRecord) {
    this.#usage.invocations.push(record);
    addAdvisorUsage(this.#usage.totals, record.usage);
  }
  issueAdvice(
    id: string,
    advice: string,
    trigger: ConsultationTrigger,
    draft = false
  ) {
    this.#ledger.issued.set(id, { advice, trigger });
    this.#ledger.lastAdvice = advice;
    if (draft) {
      this.#ledger.draftConsultations += 1;
    }
  }
  claimTrackedFiles(paths: string[]) {
    const advice = this.#ledger.lastAdvice;
    if (!advice || paths.length === 0) {
      return false;
    }
    const mentioned = paths.every((path) => {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const boundary =
        "(^|[\\s\\\"'`()\\[])" +
        escaped +
        "(?=$|[\\s\\\"'`),;:!?\\]]|\\.(?=\\s|$))";
      return new RegExp(boundary).test(advice);
    });
    if (!mentioned) {
      return false;
    }
    this.#ledger.lastAdvice = undefined;
    return true;
  }

  reserveAdvice(id: string) {
    if (this.#ledger.reported.has(id) || this.#ledger.pending.has(id)) {
      return;
    }
    const advice = this.#ledger.issued.get(id);
    if (!advice) {
      return;
    }
    this.#ledger.pending.add(id);
    return advice;
  }

  commitAdvice(id: string) {
    if (!this.#ledger.pending.delete(id)) {
      return false;
    }
    this.#ledger.reported.add(id);
    this.#ledger.outcomes += 1;
    return true;
  }

  releaseAdvice(id: string) {
    this.#ledger.pending.delete(id);
  }

  /** Compatibility helper for synchronous callers that can commit immediately. */
  claimAdvice(id: string) {
    const advice = this.reserveAdvice(id);
    if (!advice) {
      return;
    }
    this.commitAdvice(id);
    return advice;
  }

  #decisionsLine() {
    const gates = this.#usage.invocations.filter(
      (item) => item.kind === "gate"
    );
    return (
      (["proceed", "revise", "blocked"] as GateDecision[])
        .map(
          (decision) =>
            [
              decision,
              gates.filter((item) => item.decision === decision).length,
            ] as const
        )
        .filter(([, count]) => count > 0)
        .map(([decision, count]) => `${count} ${decision}`)
        .join(", ") || "none"
    );
  }

  #countTrigger(trigger: AdvisorTrigger) {
    return this.#usage.invocations.filter((item) => item.trigger === trigger)
      .length;
  }

  #triggersLine() {
    return (
      [
        "manual",
        "executor-requested",
        "repeated-tool-call",
        "completion-review",
        "custom-rule",
      ]
        .filter((trigger) => this.#countTrigger(trigger as AdvisorTrigger) > 0)
        .join(", ") || "none"
    );
  }

  summary(limit: number | undefined) {
    const { invocations, totals } = this.#usage;
    if (invocations.length === 0 && this.#repetition.interventions === 0) {
      return;
    }
    const markdown = invocations.filter((item) => item.kind === "markdown");
    const gates = invocations.filter((item) => item.kind === "gate");
    const effects = (effect: ExecutionEffect) =>
      invocations.filter((item) => item.executionEffect === effect).length;
    const failures = invocations
      .filter((item) => item.failure)
      .map((item) => item.failure);
    const models =
      [...new Set(invocations.map((item) => item.model).filter(Boolean))].join(
        ", "
      ) || "unknown";
    const budget =
      limit === undefined
        ? `${this.#consumedCalls} used; unlimited remaining`
        : `${this.#consumedCalls} / ${limit} used; ${Math.max(0, limit - this.#consumedCalls)} remaining`;
    return [
      "[Session Advisor Summary]",
      `Consultations: ${markdown.length} Markdown (${this.#countTrigger("manual")} manual, ${this.#countTrigger("executor-requested")} executor-requested), automatic gates: ${gates.length}`,
      `Triggers: ${this.#triggersLine()}`,
      `Models: ${models}`,
      `Budget: ${budget}`,
      `Usage: ${formatAdvisorUsageTotals(totals)}`,
      `Markdown advice: ${markdown.length} responses (${this.#ledger.draftConsultations} with drafts)`,
      `Outcome reports: ${this.#ledger.outcomes}`,
      `Gate decisions: ${this.#decisionsLine()}`,
      `Loop matching: normalized tool signatures; ${this.#repetition.interventions} gate intervention${this.#repetition.interventions === 1 ? "" : "s"}`,
      `Execution effects: ${effects("tool-blocked")} tool blocked, ${effects("session-blocked")} sessions blocked, ${effects("continued")} continued`,
      `Failures: ${failures.length ? failures.join(", ") : "none"}`,
    ].join("\n");
  }
}
