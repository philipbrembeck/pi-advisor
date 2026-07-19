export type AdvisorVerdict = "proceed" | "revise" | "blocked" | "insufficient-evidence";
export type ConsultationOrigin = "executor" | "automatic" | "manual";

type Consultation = { origin: ConsultationOrigin; verdict?: AdvisorVerdict };

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
};

export class AdvisorSessionState {
  #previousSignature?: string;
  #repetitions = 0;
  #blockedReason?: string;
  #consultations: Consultation[] = [];
  #loopInterventions = 0;
  #automaticCalls = 0;

  resetTask() {
    this.#previousSignature = undefined;
    this.#repetitions = 0;
    this.#blockedReason = undefined;
    this.#consultations = [];
    this.#loopInterventions = 0;
    this.#automaticCalls = 0;
  }

  clearBlocked() { this.#blockedReason = undefined; }
  resetRepetition() { this.#previousSignature = undefined; this.#repetitions = 0; }
  get blocked() { return this.#blockedReason !== undefined; }
  get blockedReason() { return this.#blockedReason; }
  block(reason: string) { this.#blockedReason ??= reason; }

  recordToolCall(toolName: string, input: unknown, threshold: number) {
    if (toolName === "ask_advisor") return false;
    const signature = `${toolName}:${stableJson(input)}`;
    this.#repetitions = signature === this.#previousSignature ? this.#repetitions + 1 : 1;
    this.#previousSignature = signature;
    if (this.#repetitions < threshold) return false;
    this.#loopInterventions += 1;
    return true;
  }

  canUseAutomaticCall(limit: number | undefined) {
    return limit === undefined || this.#automaticCalls < limit;
  }

  consumeAutomaticCall() { this.#automaticCalls += 1; }
  remainingAutomaticCalls(limit: number | undefined) {
    return limit === undefined ? undefined : Math.max(0, limit - this.#automaticCalls);
  }

  recordConsultation(origin: ConsultationOrigin, verdict?: AdvisorVerdict) {
    this.#consultations.push({ origin, verdict });
  }

  summary(limit: number | undefined) {
    if (this.#consultations.length === 0 && this.#loopInterventions === 0) return undefined;
    const count = (origin: ConsultationOrigin) => this.#consultations.filter((item) => item.origin === origin).length;
    const verdicts = (["proceed", "revise", "insufficient-evidence", "blocked"] as AdvisorVerdict[])
      .map((verdict) => [verdict, this.#consultations.filter((item) => item.verdict === verdict).length] as const)
      .filter(([, count]) => count > 0)
      .map(([verdict, count]) => `${count} ${verdict}`)
      .join(", ") || "none recorded";
    const budget = limit === undefined ? "unlimited" : `${this.#automaticCalls} / ${limit} used`;
    return [
      "[Session Advisor Summary]",
      `Consultations: ${this.#consultations.length} — ${count("executor")} Executor-requested, ${count("automatic")} automatic, ${count("manual")} manual`,
      `Verdicts: ${verdicts}`,
      `Loop interventions: ${this.#loopInterventions}`,
      `Automatic budget: ${budget}`,
    ].join("\n");
  }
}
