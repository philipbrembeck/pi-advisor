import type { EventBus } from "@earendil-works/pi-coding-agent";
import { redactAndCapText } from "./conversation.js";

export const BENCHMARK_TELEMETRY_CHANNEL = "pi-advisor:benchmark";
const BENCHMARK_CONTEXT = "PI_ADVISOR_BENCHMARK_CONTEXT";
const BENCHMARK_RUN_ID = "PI_ADVISOR_BENCHMARK_RUN_ID";
const BENCHMARK_TOKEN = "PI_ADVISOR_BENCHMARK_TOKEN";
const MAX_TEXT_BYTES = 2000;
const MAX_LABELS = 32;
const MAX_LABEL_BYTES = 160;

export interface BenchmarkAdvisorStart {
  model: string;
  question?: string;
  trigger?: string;
}

export interface BenchmarkAdvisorEnd extends BenchmarkAdvisorStart {
  outcome?: string;
  response?: string;
  usage?: unknown;
}

export interface BenchmarkAdvisorError extends BenchmarkAdvisorStart {
  category: "provider-error" | "empty-response" | "cancelled" | "unknown";
}

export type BenchmarkScoutEvent =
  | { model: string; type: "call" }
  | {
      availableCount?: number;
      latencyMs?: number;
      model: string;
      omittedBeforeScout?: number;
      selectedCount?: number;
      selectedLabels?: string[];
      synthesis?: string;
      type: "success";
      usage?: unknown;
    }
  | {
      availableCount?: number;
      fallback?: string;
      latencyMs?: number;
      model: string;
      omittedBeforeScout?: number;
      selectedCount?: number;
      type: "fallback";
      usage?: unknown;
    }
  | { type: "cancelled" };

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
      outcome?: string;
      response?: string;
      timestamp: string;
      usage?: Record<string, unknown>;
    }
  | {
      type: "advisor:error";
      category: BenchmarkAdvisorError["category"];
      runId: string;
      model: string;
      timestamp: string;
    }
  | {
      event: BenchmarkScoutEvent;
      runId: string;
      timestamp: string;
      type: "scout";
    }
  | {
      fields: Record<string, unknown>;
      runId: string;
      timestamp: string;
      type: "provider-request";
    };

type BenchmarkTelemetryPayload = {
  [K in BenchmarkTelemetryEvent["type"]]: Omit<
    Extract<BenchmarkTelemetryEvent, { type: K }>,
    "runId" | "timestamp"
  >;
}[BenchmarkTelemetryEvent["type"]];

export interface BenchmarkTelemetry {
  advisorEnd: (event: BenchmarkAdvisorEnd) => void;
  advisorError: (event: BenchmarkAdvisorError) => void;
  advisorStart: (event: BenchmarkAdvisorStart) => void;
  providerRequest: (payload: unknown) => void;
  scout: (event: BenchmarkScoutEvent) => void;
}

const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const usageSnapshot = (usage: unknown): Record<string, unknown> | undefined => {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }
  const source = usage as Record<string, unknown>;
  const { cost } = source;
  const costSource =
    cost && typeof cost === "object"
      ? (cost as Record<string, unknown>)
      : undefined;
  const result = Object.fromEntries(
    ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]
      .map((key) => [key, finite(source[key])] as const)
      .filter(([, value]) => value !== undefined)
  ) as Record<string, unknown>;
  const providerCost = finite(costSource?.total);
  if (providerCost !== undefined) {
    result.cost = { total: providerCost };
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const text = (value: string | undefined, maxBytes = MAX_TEXT_BYTES) =>
  value ? redactAndCapText(value, maxBytes, true) : undefined;

const labels = (values: string[] | undefined) =>
  values
    ?.slice(0, MAX_LABELS)
    .map((value) => text(value, MAX_LABEL_BYTES))
    .filter((value): value is string => Boolean(value));

const PROVIDER_SENSITIVE_KEY = /message|prompt|content|input|system/i;
const SAFE_PROVIDER_FIELDS = new Set([
  "max_completion_tokens",
  "max_tokens",
  "parallel_tool_calls",
  "reasoning_effort",
  "temperature",
  "top_p",
  "tool_choice",
]);
const sanitizeProviderValue = (value: unknown, depth = 0): unknown => {
  if (depth > 3 || value === null) {
    return value;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value === "string" ? text(value, 320) : value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 16)
      .map((item) => sanitizeProviderValue(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !PROVIDER_SENSITIVE_KEY.test(key))
        .slice(0, 32)
        .map(([key, item]) => [key, sanitizeProviderValue(item, depth + 1)])
    );
  }
  return undefined;
};

const providerFields = (payload: unknown): Record<string, unknown> => {
  const value =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    [...SAFE_PROVIDER_FIELDS]
      .filter((key) => key in value)
      .map((key) => [key, sanitizeProviderValue(value[key])])
  );
};

const enabledCapability = () => {
  const context = process.env[BENCHMARK_CONTEXT] === "1";
  const runId = process.env[BENCHMARK_RUN_ID];
  const token = process.env[BENCHMARK_TOKEN];
  if (!(context && runId && token && token.length >= 32)) {
    return;
  }
  return { runId, token };
};

export const createBenchmarkTelemetry = (
  events: EventBus
): BenchmarkTelemetry | undefined => {
  const capability = enabledCapability();
  if (!capability) {
    return undefined;
  }
  const emit = (event: BenchmarkTelemetryPayload) => {
    try {
      events.emit(BENCHMARK_TELEMETRY_CHANNEL, {
        ...event,
        runId: capability.runId,
        timestamp: new Date().toISOString(),
      } satisfies BenchmarkTelemetryEvent);
    } catch {
      // Benchmark diagnostics must never change Advisor/Scout behavior.
    }
  };
  return {
    advisorEnd: (event) =>
      emit({
        model: event.model,
        outcome: text(event.outcome, 160),
        response: text(event.response),
        type: "advisor:end",
        usage: usageSnapshot(event.usage),
      }),
    advisorError: (event) =>
      emit({
        category: event.category,
        model: event.model,
        type: "advisor:error",
      }),
    advisorStart: (event) =>
      emit({
        model: event.model,
        question: text(event.question),
        trigger: text(event.trigger, 160),
        type: "advisor:start",
      }),
    providerRequest: (payload) => {
      emit({
        fields: providerFields(payload),
        type: "provider-request",
      });
    },
    scout: (event) => {
      if (event.type === "call" || event.type === "cancelled") {
        emit({ event, type: "scout" });
        return;
      }
      emit({
        event: {
          ...(event.type === "success"
            ? {
                selectedLabels: labels(event.selectedLabels),
                synthesis: text(event.synthesis),
              }
            : { fallback: text(event.fallback, 320) }),
          availableCount: finite(event.availableCount),
          latencyMs: finite(event.latencyMs),
          model: event.model,
          omittedBeforeScout: finite(event.omittedBeforeScout),
          selectedCount: finite(event.selectedCount),
          type: event.type,
          usage: usageSnapshot(event.usage),
        },
        type: "scout",
      });
    },
  };
};
