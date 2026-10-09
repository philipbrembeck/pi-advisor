import { describe, expect, test } from "bun:test";

import { noul } from "@typesafe-ai/sdk";
import type { Fetch } from "@typesafe-ai/sdk";

import { JevClient, JevFailure } from "../src/jev/client.ts";
import { screeningQuestions } from "../src/jev/questions.ts";

const API_KEY = "tsk-test-key-material-9f8e7d6c";

const jsonResponse = <T>(body: T, status = 200) =>
  Response.json(body, {
    headers: { "content-type": "application/json" },
    status,
  });

const validBody = {
  answers: { proceed: { noul: 0.9, type: "noul" } },
  model: "jev-test",
  usage: { input_tokens: 5000, output_tokens: 0 },
};

const state = { role: "executor" };

const expectJevFailure = async <T>(ask: Promise<T>): Promise<JevFailure> => {
  const failure = await ask.catch((error: JevFailure) => error);
  if (!(failure instanceof JevFailure)) {
    throw new Error("expected ask to reject with JevFailure");
  }
  return failure;
};

const abortableFetch =
  (handler: Fetch) => (input: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const rejectOnAbort = () => reject(new Error("fetch aborted"));
      if (init?.signal?.aborted) {
        rejectOnAbort();
        return;
      }
      init?.signal?.addEventListener("abort", rejectOnAbort, { once: true });
      handler(input, init).then(resolve).catch(reject);
    });

const hangingFetch = () =>
  abortableFetch(() => new Promise<Response>(() => {}));

const client = (fetch: Fetch, timeoutMs = 5000) =>
  new JevClient({
    apiKey: API_KEY,
    fetch,
    model: "jev-test",
    timeoutMs,
    transport: "typesafe",
  });

const decisionsClient = (fetch: Fetch, timeoutMs = 5000) =>
  new JevClient({
    apiKey: API_KEY,
    fetch,
    model: "ignored",
    timeoutMs,
    transport: "openai-decisions",
  });

describe("JevClient.ask", () => {
  test("returns answers and computed usage cost", async () => {
    const result = await client(async () => jsonResponse(validBody)).ask(
      state,
      { proceed: noul("Proceed?") }
    );
    expect(result.answers.proceed).toEqual({ noul: 0.9, type: "noul" });
    expect(result.model).toBe("jev-test");
    expect(result.usage).toEqual({
      cost: 0.00021,
      inputTokens: 5000,
      outputTokens: 0,
    });
  });

  test("posts to the transport endpoint with bearer auth", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetch: Fetch = async (url, init) => {
      captured = { init, url };
      return jsonResponse(validBody);
    };
    const result = await client(fetch).ask(state, {
      proceed: noul("Proceed?"),
    });
    expect(result.answers.proceed).toBeDefined();
    expect(captured?.url).toBe("https://api.typesafe.ai/v1/systemone");
    const headers = new Headers(captured?.init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(String(captured?.init?.body)).model).toBe("jev-test");
  });

  test("posts a custom endpoint to its Base URL with the unmodified model", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const endpointFetch: Fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = String(init?.body);
      return jsonResponse(validBody);
    };
    const endpointClient = new JevClient({
      apiKey: API_KEY,
      baseUrl: "https://gw.corp/llm/jev",
      fetch: endpointFetch,
      model: "jev-latest",
      timeoutMs: 5000,
      transport: "typesafe-compatible",
    });
    const result = await endpointClient.ask(state, {
      proceed: noul("Proceed?"),
    });
    expect(capturedUrl).toBe("https://gw.corp/llm/jev/v1/systemone");
    expect(JSON.parse(capturedBody)).toEqual({
      model: "jev-latest",
      questions: { proceed: expect.anything() },
      state,
    });
    expect(result.usage).toEqual({
      cost: 0.00021,
      inputTokens: 5000,
      outputTokens: 0,
    });
  });

  test("names the endpoint provider when a request fails", async () => {
    const failure = await expectJevFailure(
      new JevClient({
        apiKey: API_KEY,
        baseUrl: "https://api.codiv.ai",
        fetch: async () => jsonResponse({ error: "nope" }, 500),
        model: "jev-latest",
        timeoutMs: 5000,
        transport: "typesafe-compatible",
      }).ask(state, { proceed: noul("Proceed?") })
    );
    expect(failure.message).toContain("endpoint");
    expect(failure.message).not.toContain("TypeSafe");
  });

  test("refuses to call a custom endpoint that has no Base URL", () => {
    expect(
      () =>
        new JevClient({
          apiKey: API_KEY,
          fetch: async () => jsonResponse(validBody),
          model: "jev-latest",
          timeoutMs: 5000,
          transport: "typesafe-compatible",
        })
    ).toThrow(JevFailure);
  });

  test("prefixes OpenRouter models without a namespace", async () => {
    let capturedBody = "";
    const openRouterFetch: Fetch = async (_url, init) => {
      capturedBody = String(init?.body);
      return jsonResponse(validBody);
    };
    const openRouterClient = new JevClient({
      apiKey: API_KEY,
      fetch: openRouterFetch,
      model: "jev-latest",
      timeoutMs: 5000,
      transport: "openrouter",
    });
    await openRouterClient.ask(state, { proceed: noul("Proceed?") });
    expect(JSON.parse(capturedBody).model).toBe("~typesafe/jev-latest");
  });

  test("keeps a fully-qualified OpenRouter model id as-is", async () => {
    let capturedBody = "";
    const openRouterFetch: Fetch = async (_url, init) => {
      capturedBody = String(init?.body);
      return jsonResponse(validBody);
    };
    const openRouterClient = new JevClient({
      apiKey: API_KEY,
      fetch: openRouterFetch,
      model: "typesafe/jev-1.13",
      timeoutMs: 5000,
      transport: "openrouter",
    });
    await openRouterClient.ask(state, { proceed: noul("Proceed?") });
    expect(JSON.parse(capturedBody).model).toBe("typesafe/jev-1.13");
  });

  test("classifies a 401 as auth without leaking key material", async () => {
    const failure = await expectJevFailure(
      client(async () => jsonResponse({ error: "invalid api key" }, 401)).ask(
        state,
        { proceed: noul("Proceed?") }
      )
    );
    expect(failure).toBeInstanceOf(JevFailure);
    expect(failure.category).toBe("auth");
    expect(failure.message).not.toContain(API_KEY);
  });

  test("lets the total deadline cancel a pending retry", async () => {
    let calls = 0;
    const failure = await expectJevFailure(
      client(
        abortableFetch(async () => {
          calls += 1;
          return calls === 1
            ? jsonResponse({ error: "slow down" }, 429)
            : jsonResponse(validBody);
        }),
        150
      ).ask(state, { proceed: noul("Proceed?") })
    );
    expect(failure).toBeInstanceOf(JevFailure);
    expect(failure.category).toBe("timeout");
    expect(failure.message).toContain("150 ms");
    expect(calls).toBe(1);
  }, 10_000);

  test("times out a hanging fetch within the wall budget", async () => {
    const failure = await expectJevFailure(
      client(hangingFetch(), 100).ask(state, { proceed: noul("Proceed?") })
    );
    expect(failure).toBeInstanceOf(JevFailure);
    expect(failure.category).toBe("timeout");
  }, 10_000);

  test("retries a 429 once and returns the second attempt's answers", async () => {
    let calls = 0;
    const result = await client(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ error: "slow down" }, 429)
        : jsonResponse(validBody);
    }).ask(state, { proceed: noul("Proceed?") });
    expect(result.answers.proceed).toBeDefined();
    expect(calls).toBe(2);
  });

  test("does not retry a 401", async () => {
    let calls = 0;
    const failure = await expectJevFailure(
      client(async () => {
        calls += 1;
        return jsonResponse({ error: "unauthorized" }, 401);
      }).ask(state, { proceed: noul("Proceed?") })
    );
    expect(failure).toBeInstanceOf(JevFailure);
    expect(failure.category).toBe("auth");
    expect(calls).toBe(1);
  });

  test("classifies malformed responses", async () => {
    const failure = await expectJevFailure(
      client(async () =>
        jsonResponse({ answers: "garbage", model: "jev-test", usage: {} })
      ).ask(state, { proceed: noul("Proceed?") })
    );
    expect(failure).toBeInstanceOf(JevFailure);
    expect(failure.category).toBe("malformed");
  });

  test("classifies non-JSON success responses as malformed", async () => {
    const failure = await expectJevFailure(
      client(
        async () => new Response("<html>gateway</html>", { status: 200 })
      ).ask(state, { proceed: noul("Proceed?") })
    );
    expect(failure).toBeInstanceOf(JevFailure);
    expect(failure.category).toBe("malformed");
  });

  test("classifies validation errors as malformed", async () => {
    const failure = await expectJevFailure(
      client(async () =>
        jsonResponse({ error: { message: "bad rubric" } }, 422)
      ).ask(state, { proceed: noul("Proceed?") })
    );
    expect(failure).toBeInstanceOf(JevFailure);
    expect(failure.category).toBe("malformed");
    expect(failure.message).toContain("bad rubric");
  });

  test("classifies connection failures as network and retries once", async () => {
    let calls = 0;
    const failure = await expectJevFailure(
      client(async () => {
        calls += 1;
        throw new Error("ECONNREFUSED connection refused");
      }).ask(state, { proceed: noul("Proceed?") })
    );
    expect(failure).toBeInstanceOf(JevFailure);
    expect(failure.category).toBe("network");
    expect(calls).toBe(2);
  });

  test("propagates caller cancellation instead of classifying it", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      client(hangingFetch()).ask(
        state,
        { proceed: noul("Proceed?") },
        controller.signal
      )
    ).rejects.toThrow("Jev call aborted by the caller.");
  });

  test("caller cancellation takes precedence when fetch resolves with 429", async () => {
    const controller = new AbortController();
    let resolveResponse: ((response: Response) => void) | undefined;
    let calls = 0;
    const startedAt = performance.now();
    const pending = client(() => {
      calls += 1;
      return new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      });
    }).ask(state, { proceed: noul("Proceed?") }, controller.signal);

    controller.abort();
    resolveResponse?.(jsonResponse({ error: "slow down" }, 429));

    await expect(pending).rejects.toThrow("Jev call aborted by the caller.");
    expect(calls).toBe(1);
    expect(performance.now() - startedAt).toBeLessThan(200);
  });

  test("treats missing usage as zero tokens rather than failing", async () => {
    const result = await client(async () =>
      jsonResponse({
        answers: { proceed: { noul: 0.5, type: "noul" } },
        model: "jev-test",
      })
    ).ask(state, { proceed: noul("Proceed?") });
    expect(result.usage).toEqual({ cost: 0, inputTokens: 0, outputTokens: 0 });
  });
});

const decisionsBody = {
  answers: [
    {
      confidence: 0.9,
      name: "stakes",
      probabilities: [
        { label: "High", probability: 0.05, value: 2 },
        { label: "Negligible", probability: 0.9, value: 0 },
        { label: "Moderate", probability: 0.05, value: 1 },
      ],
      score: 0.15,
      type: "score",
    },
    {
      name: "self_answerable",
      probability: 0.9,
      type: "predicate",
    },
  ],
  model: "gpt-6-luna",
  usage: { input_tokens: 159, output_tokens: 0 },
};

describe("OpenAI Decisions JevClient", () => {
  test("sends bounded state and named questions to the fixed endpoint/model", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const result = await new JevClient({
      apiKey: API_KEY,
      fetch: async (url, init) => {
        captured = { init, url };
        return jsonResponse(decisionsBody);
      },
      model: "ignored-jev-model",
      pricePerMtok: 999,
      timeoutMs: 5000,
      transport: "openai-decisions",
    }).ask(state, screeningQuestions);

    expect(captured?.url).toBe("https://api.openai.com/v1/decisions");
    const headers = new Headers(captured?.init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    const body = JSON.parse(String(captured?.init?.body));
    expect(body).toEqual({
      input: JSON.stringify(state, null, 2),
      model: "gpt-6-luna",
      questions: [
        {
          instructions: expect.stringContaining(
            "Can the executor confidently resolve"
          ),
          name: "self_answerable",
          type: "predicate",
        },
        {
          instructions: expect.stringContaining("How material are the stakes"),
          levels: [
            {
              description: expect.stringContaining("Negligible:"),
              label: "Negligible",
            },
            {
              description: expect.stringContaining("Moderate:"),
              label: "Moderate",
            },
            { description: expect.stringContaining("High:"), label: "High" },
          ],
          name: "stakes",
          type: "score",
        },
      ],
    });
    expect(result.answers.self_answerable).toEqual({ noul: 0.9, type: "noul" });
    expect(result.answers.stakes).toMatchObject({
      probabilities: { "0": 0.9, "1": 0.05, "2": 0.05 },
      type: "score",
    });
    expect(result.model).toBe("gpt-6-luna");
    expect(result.usage).toEqual({
      cost: undefined,
      inputTokens: 159,
      outputTokens: 0,
    });
  });

  test("classifies auth and validation failures without retrying or leaking secrets", async () => {
    let calls = 0;
    const auth = await expectJevFailure(
      decisionsClient(async () => {
        calls += 1;
        return jsonResponse({ error: `Bearer ${API_KEY}` }, 401);
      }).ask(state, screeningQuestions)
    );
    expect(auth.category).toBe("auth");
    expect(auth.message).not.toContain(API_KEY);
    expect(auth.message).toContain("[REDACTED SECRET]");
    expect(calls).toBe(1);

    const validation = await expectJevFailure(
      decisionsClient(async () =>
        jsonResponse({ error: { message: "invalid decision schema" } }, 422)
      ).ask(state, screeningQuestions)
    );
    expect(validation.category).toBe("malformed");
    expect(validation.message).toContain("invalid decision schema");
  });

  test("keeps timeout and caller cancellation behavior for Decisions requests", async () => {
    const timeout = await expectJevFailure(
      decisionsClient(hangingFetch(), 100).ask(state, screeningQuestions)
    );
    expect(timeout.category).toBe("timeout");

    const controller = new AbortController();
    controller.abort();
    await expect(
      decisionsClient(hangingFetch()).ask(
        state,
        screeningQuestions,
        controller.signal
      )
    ).rejects.toThrow("Jev call aborted by the caller.");
  });

  test("retries transient errors and validates the Decisions JSON contract", async () => {
    let calls = 0;
    const result = await new JevClient({
      apiKey: API_KEY,
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ error: "slow down" }, 429)
          : jsonResponse(decisionsBody);
      },
      model: "unused",
      timeoutMs: 5000,
      transport: "openai-decisions",
    }).ask(state, screeningQuestions);
    expect(calls).toBe(2);
    expect(result.usage.inputTokens).toBe(159);

    const malformed = await expectJevFailure(
      new JevClient({
        apiKey: API_KEY,
        fetch: async () => new Response("not json", { status: 200 }),
        model: "unused",
        timeoutMs: 5000,
        transport: "openai-decisions",
      }).ask(state, screeningQuestions)
    );
    expect(malformed.category).toBe("malformed");
  });
});
