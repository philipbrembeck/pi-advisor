import { afterEach, describe, expect, test } from "bun:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
  BENCHMARK_TELEMETRY_CHANNEL,
  createBenchmarkTelemetry,
} from "../src/telemetry.js";

const ENV_KEYS = [
  "PI_ADVISOR_BENCHMARK_CONTEXT",
  "PI_ADVISOR_BENCHMARK_RUN_ID",
  "PI_ADVISOR_BENCHMARK_TOKEN",
] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("benchmark telemetry", () => {
  test("is disabled without the explicit benchmark capability", () => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    const events = createEventBus();
    expect(createBenchmarkTelemetry(events)).toBeUndefined();
  });

  test("rejects an invalid benchmark capability", () => {
    process.env.PI_ADVISOR_BENCHMARK_CONTEXT = "1";
    process.env.PI_ADVISOR_BENCHMARK_RUN_ID = "run-1";
    process.env.PI_ADVISOR_BENCHMARK_TOKEN = "short";
    expect(createBenchmarkTelemetry(createEventBus())).toBeUndefined();
  });

  test("emits bounded allowlisted events only with a benchmark capability", () => {
    process.env.PI_ADVISOR_BENCHMARK_CONTEXT = "1";
    process.env.PI_ADVISOR_BENCHMARK_RUN_ID = "run-1";
    process.env.PI_ADVISOR_BENCHMARK_TOKEN = "t".repeat(32);
    const events = createEventBus();
    const received: unknown[] = [];
    events.on(BENCHMARK_TELEMETRY_CHANNEL, (event) => received.push(event));
    const telemetry = createBenchmarkTelemetry(events);
    expect(telemetry).toBeDefined();

    telemetry?.advisorStart({
      model: "provider/advisor",
      question: "token=sk-test-secret",
    });
    telemetry?.advisorEnd({
      model: "provider/advisor",
      response: "x".repeat(3000),
      usage: {
        cost: { total: 1.25 },
        input: 10,
        output: 20,
        secret: "must not pass through",
      },
    });
    telemetry?.scout({
      model: "provider/scout",
      selectedLabels: ["selected"],
      synthesis: "safe synthesis",
      type: "success",
      usage: { input: 4, output: 5 },
    });
    telemetry?.providerRequest({
      max_tokens: 123,
      messages: [{ content: "must not pass through" }],
      parallel_tool_calls: true,
      secret: "must not pass through",
      temperature: 0,
      tool_choice: { function: { name: "safe_tool" }, type: "function" },
      top_p: 0.9,
    });

    expect(received).toHaveLength(4);
    const serialized = JSON.stringify(received);
    expect(serialized).not.toContain("sk-test-secret");
    expect(serialized).not.toContain("must not pass through");
    expect(serialized).not.toContain("t".repeat(32));
    expect(serialized).toContain("run-1");
    expect((received[1] as { response?: string }).response).toHaveLength(2000);
    const request = received[3] as {
      fields?: Record<string, unknown>;
    };
    expect(request.fields).toEqual({
      max_tokens: 123,
      parallel_tool_calls: true,
      temperature: 0,
      tool_choice: { function: { name: "safe_tool" }, type: "function" },
      top_p: 0.9,
    });
  });

  test("swallows telemetry sink failures", () => {
    process.env.PI_ADVISOR_BENCHMARK_CONTEXT = "1";
    process.env.PI_ADVISOR_BENCHMARK_RUN_ID = "run-1";
    process.env.PI_ADVISOR_BENCHMARK_TOKEN = "t".repeat(32);
    const telemetry = createBenchmarkTelemetry({
      emit: () => {
        throw new Error("diagnostic sink failed");
      },
      on: () => () => undefined,
    });
    expect(() =>
      telemetry?.advisorStart({ model: "provider/advisor" })
    ).not.toThrow();
  });
});
