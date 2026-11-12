import { describe, expect, test } from "bun:test";

import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import {
  collectTextStream,
  createCoalescedUpdate,
  resolveConfiguredModel,
} from "../src/model-stream.ts";
import type { CoalescedUpdateScheduler } from "../src/model-stream.ts";
import { currentSessionId } from "../src/session-context.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";

// SAFETY: fixture mirrors the catalogue fields stream() reads; "test-api" is a synthetic Api label.
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

interface StreamUsageFixture {
  input: number;
}

interface AssistantMessageFixture {
  api: string;
  content: { text: string; type: string }[];
  errorMessage?: string;
  model: string;
  provider: string;
  role: string;
  stopReason: string;
  timestamp: number;
  usage: StreamUsageFixture;
}

interface FakeStreamOptions {
  apiKey?: string;
  env?: Record<string, string>;
  headers?: Record<string, string | null>;
  reasoning?: string;
  reasoningEffort?: string;
  sessionId?: string;
  signal?: AbortSignal;
}

const DEFAULT_STREAM_USAGE: StreamUsageFixture = { input: 1 };

const assistant = (
  text: string,
  usage: StreamUsageFixture = DEFAULT_STREAM_USAGE,
  stopReason = "stop",
  errorMessage?: string
) => {
  const message: AssistantMessageFixture = {
    api: "test-api",
    content: text ? [{ text, type: "text" }] : [],
    model: "model",
    provider: "provider",
    role: "assistant",
    stopReason,
    timestamp: 1,
    usage,
  };

  if (errorMessage) {
    message.errorMessage = errorMessage;
  }

  return message;
};

// SAFETY: mock mirrors the stream() async-iterator and result() surface collectTextStream consumes.
const fakeStream = (
  events: any[],
  result: any,
  capture?: (options: FakeStreamOptions) => void
) =>
  ((_model: any, _context: any, options: FakeStreamOptions) => {
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

    const scheduler: CoalescedUpdateScheduler = {
      clearTimeout: (timer) => {
        timers.delete(Number(timer));
      },
      now: () => now,
      setTimeout: (task) => {
        const id = nextTimer;
        nextTimer += 1;

        // SAFETY: fake timer only flows back to this mock's clearTimeout, which reads its numeric id.
        const timer = { [Symbol.toPrimitive]: () => id } as ReturnType<
          typeof setTimeout
        >;

        timers.set(id, task);

        return timer;
      },
    };

    const runTimer = (timer: number) => {
      const task = timers.get(timer);
      timers.delete(timer);
      task?.();
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

    const ctx = asExtensionContext({
      modelRegistry: {
        find: (provider: string, id: string) => {
          seen.push([provider, id]);

          return model;
        },
        getApiKeyAndHeaders: (value: any) => {
          seen.push(value);

          return Promise.resolve({
            apiKey: "secret",
            env: { REGION: "test" },
            headers: { "x-test": "yes" },
            ok: true,
          });
        },
      },
    });

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
        asExtensionContext({ modelRegistry: { find: () => undefined } }),
        "provider/missing",
        "Scout"
      )
    ).rejects.toThrow("Scout model not found: provider/missing");
    await expect(
      resolveConfiguredModel(
        asExtensionContext({
          modelRegistry: {
            find: () => model,
            getApiKeyAndHeaders: () =>
              Promise.resolve({ error: "login", ok: false }),
          },
        }),
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
    let optionsSeen: FakeStreamOptions | undefined;
    await collectTextStream(
      { apiKey: "key", model, ref: "provider/model" },
      { messages: [], systemPrompt: "system" },
      fakeStream([], assistant("ok"), (options) => {
        optionsSeen = options;
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

  test("uses a registered provider wrapper and leaves auth to ModelRegistry", async () => {
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
    });

    const registry = new ModelRegistry(runtime);
    const getApiKeyAndHeaders = registry.getApiKeyAndHeaders.bind(registry);
    let authPreflightCalls = 0;
    registry.getApiKeyAndHeaders = async (value) => {
      authPreflightCalls += 1;

      return getApiKeyAndHeaders(value);
    };

    let streamSimpleCalls = 0;
    let resolvedApiKey: string | undefined;
    let wrappedApiKey: string | undefined;
    let resolvedReasoning: string | undefined;
    let receivedSignal: AbortSignal | undefined;
    const controller = new AbortController();
    registry.registerProvider("provider", {
      api: "test-api",
      apiKey: "PLAIN-KEY",
      models: [model],
      streamSimple: (providerModel, context, streamOptions) => {
        streamSimpleCalls += 1;
        resolvedApiKey = streamOptions?.apiKey;
        resolvedReasoning = streamOptions?.reasoning;
        receivedSignal = streamOptions?.signal;

        const wrappedOptions = {
          ...streamOptions,
          apiKey: "WRAPPED-SENTINEL-KEY",
        };

        wrappedApiKey = wrappedOptions.apiKey;

        return fakeStream(
          [{ delta: "advice", type: "text_delta" }],
          assistant("advice from composed provider")
        )(providerModel, context, wrappedOptions);
      },
    });
    const ctx = asExtensionContext({ modelRegistry: registry });

    const resolved = await resolveConfiguredModel(
      ctx,
      "provider/model",
      "Advisor"
    );

    expect(authPreflightCalls).toBe(0);
    expect(resolved.apiKey).toBeUndefined();

    const result = await collectTextStream(resolved, {
      messages: [
        { content: [{ text: "hi", type: "text" }], role: "user", timestamp: 1 },
      ],
      reasoning: "low",
      signal: controller.signal,
      systemPrompt: "sys",
    });

    expect(authPreflightCalls).toBe(0);
    expect(streamSimpleCalls).toBe(1);
    expect(resolvedApiKey).toBe("PLAIN-KEY");
    expect(wrappedApiKey).toBe("WRAPPED-SENTINEL-KEY");
    expect(resolvedReasoning).toBe("low");
    expect(receivedSignal).toBe(controller.signal);
    expect(result.text).toBe("advice from composed provider");

    const offResult = await collectTextStream(resolved, {
      messages: [],
      reasoning: "off",
      systemPrompt: "sys",
    });

    expect(resolvedReasoning).toBeUndefined();
    expect(offResult.text).toBe("advice from composed provider");
    await expect(
      collectTextStream(resolved, {
        messages: [],
        reasoning: "unsupported",
        systemPrompt: "sys",
      })
    ).rejects.toThrow("Unsupported Advisor reasoning level: unsupported");
  });

  test("routes a keyless virtual model through its physical provider", async () => {
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
    });

    const registry = new ModelRegistry(runtime);
    let routedApiKey: string | undefined;

    registry.registerProvider("provider", {
      api: "test-api",
      apiKey: "PHYSICAL-KEY",
      models: [model],
      streamSimple: (physicalModel, context, options) => {
        routedApiKey = options?.apiKey;

        return fakeStream([], assistant("routed advice"))(
          physicalModel,
          context,
          options
        );
      },
    });
    registry.registerVirtualModel({
      id: "auto",
      name: "Auto",
      provider: "router",
      route: () => ({ model, thinkingLevel: "off" }),
    });

    const resolved = await resolveConfiguredModel(
      asExtensionContext({ modelRegistry: registry }),
      "router/auto",
      "Advisor"
    );

    const result = await collectTextStream(resolved, {
      messages: [],
      systemPrompt: "system",
    });

    expect(resolved.model.api).toBe("pi-virtual");
    expect(result.text).toBe("routed advice");
    expect(routedApiKey).toBe("PHYSICAL-KEY");
  });

  test("surfaces registry auth errors without calling the provider wrapper", async () => {
    const previousEnvValue = process.env.PI_ADVISOR_TEST_MISSING_STREAM_KEY;
    delete process.env.PI_ADVISOR_TEST_MISSING_STREAM_KEY;

    try {
      const runtime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        refreshOnCreate: false,
      });

      const registry = new ModelRegistry(runtime);
      let streamSimpleCalled = false;
      registry.registerProvider("provider", {
        api: "test-api",
        apiKey: "$PI_ADVISOR_TEST_MISSING_STREAM_KEY",
        models: [model],
        streamSimple: () => {
          streamSimpleCalled = true;

          return fakeStream([], assistant("unexpected provider call"))();
        },
      });

      const resolved = await resolveConfiguredModel(
        asExtensionContext({ modelRegistry: registry }),
        "provider/model",
        "Advisor"
      );

      await expect(
        collectTextStream(resolved, {
          messages: [],
          systemPrompt: "sys",
        })
      ).rejects.toThrow("Failed to resolve API key for provider");
      expect(streamSimpleCalled).toBe(false);
    } finally {
      if (previousEnvValue === undefined) {
        delete process.env.PI_ADVISOR_TEST_MISSING_STREAM_KEY;
      } else {
        process.env.PI_ADVISOR_TEST_MISSING_STREAM_KEY = previousEnvValue;
      }
    }
  });

  test("reads the session id for each stream request", async () => {
    let sessionId = "session-a";
    const sessionIds: (string | undefined)[] = [];

    const ctx = asExtensionContext({
      modelRegistry: {
        find: () => model,
        streamSimple: (
          _model: Model<Api>,
          _context: Context,
          options?: SimpleStreamOptions
        ) => {
          sessionIds.push(options?.sessionId);

          return fakeStream([], assistant("advice"))();
        },
      },
      sessionManager: { getSessionId: () => sessionId },
    });

    const resolved = await resolveConfiguredModel(
      ctx,
      "provider/model",
      "Advisor"
    );

    await collectTextStream(resolved, {
      messages: [],
      sessionId: currentSessionId(ctx),
      systemPrompt: "sys",
    });

    sessionId = "session-b";

    await collectTextStream(resolved, {
      messages: [],
      sessionId: currentSessionId(ctx),
      systemPrompt: "sys",
    });

    expect(sessionIds).toEqual(["session-a", "session-b"]);
  });

  test("streams without a session id when the host has no accessor", async () => {
    let capturedOptions: SimpleStreamOptions | undefined;

    const ctx = asExtensionContext({
      modelRegistry: {
        find: () => model,
        streamSimple: (
          _model: Model<Api>,
          _context: Context,
          options?: SimpleStreamOptions
        ) => {
          capturedOptions = options;

          return fakeStream([], assistant("advice"))();
        },
      },
      sessionManager: {},
    });

    const resolved = await resolveConfiguredModel(
      ctx,
      "provider/model",
      "Advisor"
    );

    const result = await collectTextStream(resolved, {
      messages: [],
      sessionId: currentSessionId(ctx),
      systemPrompt: "sys",
    });

    expect(capturedOptions?.sessionId).toBeUndefined();
    expect(result.text).toBe("advice");
  });

  test("uses compat streaming only when the registry has no streamSimple", async () => {
    let capturedOptions: FakeStreamOptions | undefined;

    const ctx = asExtensionContext({
      modelRegistry: {
        find: () => model,
        getApiKeyAndHeaders: () =>
          Promise.resolve({ apiKey: "legacy-key", ok: true }),
        streamSimple: undefined,
      },
      sessionManager: { getSessionId: () => "session-1" },
    });

    const resolved = await resolveConfiguredModel(
      ctx,
      "provider/model",
      "Advisor"
    );

    const result = await collectTextStream(
      resolved,
      {
        messages: [],
        reasoning: "medium",
        sessionId: currentSessionId(ctx),
        systemPrompt: "system",
      },
      fakeStream([], assistant("legacy stream"), (options) => {
        capturedOptions = options;
      })
    );

    expect(capturedOptions).toMatchObject({
      apiKey: "legacy-key",
      reasoning: "medium",
      reasoningEffort: "medium",
      sessionId: "session-1",
    });
    expect(result.text).toBe("legacy stream");
  });
});
