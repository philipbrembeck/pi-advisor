import { describe, expect, test } from "bun:test";
import {
  collectTextStream,
  createCoalescedUpdate,
  resolveConfiguredModel,
} from "../src/model-stream.js";

const model = {
  api: "test-api",
  baseUrl: "https://example.test",
  contextWindow: 1000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "model",
  input: ["text"],
  maxTokens: 100,
  name: "Model",
  provider: "provider",
  reasoning: true,
} as any;

const assistant = (
  text: string,
  usage: unknown = { input: 1 },
  stopReason = "stop",
  errorMessage?: string
) => ({
  api: "test-api",
  content: text ? [{ text, type: "text" }] : [],
  model: "model",
  provider: "provider",
  role: "assistant",
  stopReason,
  timestamp: 1,
  usage,
  ...(errorMessage ? { errorMessage } : {}),
});

const fakeStream = (
  events: unknown[],
  result: unknown,
  capture?: (options: unknown) => void
) =>
  ((_model: unknown, _context: unknown, options: unknown) => {
    capture?.(options);
    return {
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        for (const event of events) {
          yield event;
        }
      },
      result: () => Promise.resolve(result),
    };
  }) as any;

describe("model stream", () => {
  test("coalesces bursts and publishes the latest value at the interval", () => {
    const updates: string[] = [];
    let now = 0;
    let nextTimer = 0;
    const timers = new Map<number, () => void>();
    const scheduler = {
      clearTimeout: (timer: ReturnType<typeof setTimeout>) => {
        timers.delete(timer as unknown as number);
      },
      now: () => now,
      setTimeout: (callback: () => void) => {
        const timer = nextTimer;
        nextTimer += 1;
        timers.set(timer, callback);
        return timer as unknown as ReturnType<typeof setTimeout>;
      },
    };
    const runTimer = (timer: number) => {
      const callback = timers.get(timer);
      timers.delete(timer);
      callback?.();
    };
    const coalesced = createCoalescedUpdate(
      (value: string) => updates.push(value),
      100,
      scheduler
    );

    coalesced.update("first");
    coalesced.update("second");
    coalesced.update("third");
    expect(updates).toEqual(["first"]);
    expect(timers.size).toBe(1);

    now = 99;
    expect(updates).toEqual(["first"]);
    now = 100;
    runTimer(0);
    expect(updates).toEqual(["first", "third"]);

    coalesced.update("fourth");
    now = 199;
    expect(updates).toEqual(["first", "third"]);
    now = 200;
    runTimer(1);
    expect(updates).toEqual(["first", "third", "fourth"]);

    coalesced.update("late");
    expect(coalesced.flush()).toEqual({ failed: false });
    expect(updates).toEqual(["first", "third", "fourth", "late"]);
    expect(timers.size).toBe(0);

    coalesced.update("ignored");
    expect(updates).toEqual(["first", "third", "fourth", "late"]);

    const cancelledUpdates: string[] = [];
    const cancelled = createCoalescedUpdate(
      (value: string) => cancelledUpdates.push(value),
      100,
      scheduler
    );
    cancelled.update("cancelled");
    cancelled.update("pending");
    expect(cancelledUpdates).toEqual(["cancelled"]);
    expect(timers.size).toBe(1);
    cancelled.cancel();
    runTimer(3);
    expect(cancelledUpdates).toEqual(["cancelled"]);
    expect(timers.size).toBe(0);
  });

  test("captures update callback errors without losing terminal control", () => {
    const error = new Error("render failed");
    const coalesced = createCoalescedUpdate(() => {
      throw error;
    }, 100);

    expect(() => coalesced.update("first")).toThrow(error);
    expect(coalesced.flush()).toEqual({ error, failed: true });
  });

  test("resolves the exact configured model and provider auth", async () => {
    const seen: unknown[] = [];
    const ctx = {
      modelRegistry: {
        find: (provider: string, id: string) => {
          seen.push([provider, id]);
          return model;
        },
        getApiKeyAndHeaders: (value: unknown) => {
          seen.push(value);
          return Promise.resolve({
            apiKey: "secret",
            env: { REGION: "test" },
            headers: { "x-test": "yes" },
            ok: true,
          });
        },
      },
    } as any;
    const resolved = await resolveConfiguredModel(
      ctx,
      "provider/model",
      "Advisor"
    );
    expect(seen).toEqual([["provider", "model"], model]);
    expect(resolved).toMatchObject({
      apiKey: "secret",
      env: { REGION: "test" },
      headers: { "x-test": "yes" },
      model,
      ref: "provider/model",
    });
  });

  test("reports missing models and auth without substitution", async () => {
    await expect(
      resolveConfiguredModel(
        { modelRegistry: { find: () => undefined } } as any,
        "provider/missing",
        "Scout"
      )
    ).rejects.toThrow("Scout model not found: provider/missing");
    await expect(
      resolveConfiguredModel(
        {
          modelRegistry: {
            find: () => model,
            getApiKeyAndHeaders: () =>
              Promise.resolve({ error: "login", ok: false }),
          },
        } as any,
        "provider/model",
        "Scout"
      )
    ).rejects.toThrow("login");
  });

  test("preserves stream options, chunk order, final text, and usage", async () => {
    const chunks: string[] = [];
    let optionsSeen: any;
    const { signal } = new AbortController();
    const result = await collectTextStream(
      {
        apiKey: "key",
        env: { REGION: "test" },
        headers: { header: "value" },
        model,
        ref: "provider/model",
      },
      {
        messages: [],
        onChunk: (thinking, text) => chunks.push(`${thinking}|${text}`),
        reasoning: "high",
        signal,
        systemPrompt: "system",
      },
      fakeStream(
        [
          { delta: "think", type: "thinking_delta" },
          { delta: "partial", type: "text_delta" },
        ],
        assistant("final", { input: 3 }),
        (options) => {
          optionsSeen = options;
        }
      )
    );
    expect(chunks).toEqual(["think|", "think|partial"]);
    expect(result).toEqual({
      text: "final",
      thinking: "think",
      usage: { input: 3 },
    });
    expect(optionsSeen).toMatchObject({
      apiKey: "key",
      env: { REGION: "test" },
      headers: { header: "value" },
      reasoning: "high",
      reasoningEffort: "high",
      signal,
    });
  });

  test("omits provider effort when it is not configured", async () => {
    let optionsSeen: Record<string, unknown> | undefined;
    await collectTextStream(
      { apiKey: "key", model, ref: "provider/model" },
      { messages: [], systemPrompt: "system" },
      fakeStream([], assistant("ok"), (options) => {
        optionsSeen = options as Record<string, unknown>;
      })
    );
    expect(optionsSeen).not.toHaveProperty("reasoningEffort");
  });

  test("rejects partial text from terminal provider failures", async () => {
    await Promise.all(
      (["error", "aborted"] as const).map((stopReason) =>
        expect(
          collectTextStream(
            { apiKey: "key", model, ref: "provider/model" },
            { messages: [], systemPrompt: "system" },
            fakeStream(
              [{ delta: "Decision: proceed", type: "text_delta" }],
              assistant(
                "Decision: proceed",
                { input: 1 },
                stopReason,
                "provider unavailable"
              )
            )
          )
        ).rejects.toThrow("provider unavailable")
      )
    );
  });

  test("preserves the caller cancellation reason for an aborted stream", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancelled by user");
    controller.abort(cancellation);
    await expect(
      collectTextStream(
        { apiKey: "key", model, ref: "provider/model" },
        { messages: [], signal: controller.signal, systemPrompt: "system" },
        fakeStream([], assistant("partial", { input: 1 }, "aborted"))
      )
    ).rejects.toThrow(cancellation);
  });

  test("falls back to streamed text and preserves an empty response", async () => {
    const streamed = await collectTextStream(
      { apiKey: "key", model, ref: "provider/model" },
      { messages: [], systemPrompt: "system" },
      fakeStream([{ delta: "streamed", type: "text_delta" }], assistant(""))
    );
    expect(streamed.text).toBe("streamed");
    const empty = await collectTextStream(
      { apiKey: "key", model, ref: "provider/model" },
      { messages: [], systemPrompt: "system" },
      fakeStream([], assistant(""))
    );
    expect(empty.text).toBe("");
  });
});
