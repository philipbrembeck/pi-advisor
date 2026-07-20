export type GateDecision = "proceed" | "revise" | "blocked";
export type ConsultationTrigger = "manual" | "executor-requested";
export type GateTrigger =
  | "repeated-tool-call"
  | "completion-review"
  | "custom-rule";
export type AdvisorTrigger = ConsultationTrigger | GateTrigger;
export type ExecutionEffect = "continued" | "tool-blocked" | "session-blocked";

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
const TIMESTAMP_KEY = /timestamp|time|date/;
const REQUEST_ID_KEY = /requestid|correlationid|traceid/;
const isVolatileKey = (key: string, pattern: RegExp) =>
  pattern.test(key.replace(/[-_]/g, "").toLowerCase());

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
      if (key && isVolatileKey(key, TIMESTAMP_KEY)) {
        return "<timestamp>";
      }
      if (key && isVolatileKey(key, REQUEST_ID_KEY)) {
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

export class AdvisorSessionState {
  #previousSignature?: string;
  #repetitions = 0;
  #blockedReason?: string;
  #invocations: AdvisorInvocationRecord[] = [];
  #loopInterventions = 0;
  #consumedCalls = 0;

  resetTask() {
    this.#previousSignature = undefined;
    this.#repetitions = 0;
    this.#blockedReason = undefined;
    this.#invocations = [];
    this.#loopInterventions = 0;
    this.#consumedCalls = 0;
  }

  clearBlocked() {
    this.#blockedReason = undefined;
  }
  resetRepetition() {
    this.#previousSignature = undefined;
    this.#repetitions = 0;
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
    this.#repetitions =
      signature === this.#previousSignature ? this.#repetitions + 1 : 1;
    this.#previousSignature = signature;
    if (this.#repetitions < threshold) {
      return false;
    }
    this.#loopInterventions += 1;
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

  recordInvocation(record: AdvisorInvocationRecord) {
    this.#invocations.push(record);
  }

  summary(limit: number | undefined) {
    if (this.#invocations.length === 0 && this.#loopInterventions === 0) {
      return;
    }
    const markdown = this.#invocations.filter(
      (item) => item.kind === "markdown"
    );
    const gates = this.#invocations.filter((item) => item.kind === "gate");
    const countTrigger = (trigger: AdvisorTrigger) =>
      this.#invocations.filter((item) => item.trigger === trigger).length;
    const decisions =
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
        .join(", ") || "none";
    const effects = (effect: ExecutionEffect) =>
      this.#invocations.filter((item) => item.executionEffect === effect)
        .length;
    const failures = this.#invocations
      .filter((item) => item.failure)
      .map((item) => item.failure);
    const models =
      [
        ...new Set(this.#invocations.map((item) => item.model).filter(Boolean)),
      ].join(", ") || "unknown";
    const budget =
      limit === undefined
        ? `${this.#consumedCalls} used; unlimited remaining`
        : `${this.#consumedCalls} / ${limit} used; ${Math.max(0, limit - this.#consumedCalls)} remaining`;
    return [
      "[Session Advisor Summary]",
      `Consultations: ${markdown.length} Markdown (${countTrigger("manual")} manual, ${countTrigger("executor-requested")} executor-requested), automatic gates: ${gates.length}`,
      `Triggers: ${["manual", "executor-requested", "repeated-tool-call", "completion-review", "custom-rule"].filter((trigger) => countTrigger(trigger as AdvisorTrigger) > 0).join(", ") || "none"}`,
      `Models: ${models}`,
      `Budget: ${budget}`,
      `Markdown advice: ${markdown.length} responses`,
      `Gate decisions: ${decisions}`,
      `Loop matching: normalized tool signatures; ${this.#loopInterventions} gate intervention${this.#loopInterventions === 1 ? "" : "s"}`,
      `Execution effects: ${effects("tool-blocked")} tool blocked, ${effects("session-blocked")} sessions blocked, ${effects("continued")} continued`,
      `Failures: ${failures.length ? failures.join(", ") : "none"}`,
    ].join("\n");
  }
}
