import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { AdvisorDiagnostic, RoleUsage, ScoutDiagnostic } from "./types.js";

export type BenchmarkTelemetryEvent =
  | {
      type: "advisor:start";
      runId: string;
      model: string;
      question?: string;
      trigger?: string;
      timestamp: string;
    }
  | {
      type: "advisor:end";
      runId: string;
      model: string;
      response?: string;
      usage?: unknown;
      providerCost?: number;
      outcome?: string;
      timestamp: string;
    }
  | {
      type: "advisor:error";
      runId: string;
      model: string;
      error: string;
      timestamp: string;
    }
  | {
      type: "scout";
      runId: string;
      event: Record<string, unknown>;
      timestamp: string;
    }
  | {
      type: "provider-request";
      runId: string;
      fields: Record<string, unknown>;
      timestamp: string;
    };

export class TelemetryCollector {
  readonly advisor: AdvisorDiagnostic[] = [];
  readonly providerRequests: Record<string, unknown>[] = [];
  readonly scout: ScoutDiagnostic[] = [];
  private readonly events: BenchmarkTelemetryEvent[] = [];
  private unsubscribe?: () => void;

  attach(bus: EventBus) {
    this.unsubscribe = bus.on("pi-advisor:benchmark", (value) => {
      if (!value || typeof value !== "object") {
        return;
      }
      const event = value as BenchmarkTelemetryEvent;
      this.events.push(event);
      if (event.type === "advisor:start") {
        this.advisor.push({
          question: event.question,
          timestamp: event.timestamp,
          trigger: event.trigger,
        });
      }
      if (event.type === "advisor:end") {
        const current = this.advisor.at(-1);
        if (current) {
          current.response = bound(event.response);
          current.outcome = event.outcome;
        }
      }
      if (event.type === "provider-request") {
        this.providerRequests.push(event.fields);
      }
      if (event.type === "scout") {
        this.scout.push({
          ...(event.event as unknown as ScoutDiagnostic),
          timestamp: event.timestamp,
        });
      }
    });
    return () => {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
    };
  }

  get all() {
    return [...this.events];
  }
}

const bound = (value: string | undefined, max = 1000) =>
  value ? value.slice(0, max) : undefined;
export const usageFromDiagnostics = (
  _collector: TelemetryCollector
): { advisor: RoleUsage["diagnostics"]; scout: RoleUsage["diagnostics"] } => ({
  advisor: [],
  scout: [],
});
