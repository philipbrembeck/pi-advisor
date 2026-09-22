import { describe, expect, test } from "bun:test";

import { noul } from "@typesafe-ai/sdk";

import { JevClient, JevFailure } from "../src/jev/client.ts";

const API_KEY = "tsk-test-key-material-9f8e7d6c";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });

const validBody = {
  answers: { proceed: { noul: 0.9, type: "noul" } },
  model: "jev-test",
  usage: { input_tokens: 5000, output_tokens: 0 },
};

const state = { role: "executor" };

const abortableFetch =
  (handler: (input: string, init?: RequestInit) => Promise<Response>) =>
  (input: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const rejectOnAbort = () => reject(new Error("fetch aborted"));
      if (init?.signal?.aborted) {
        rejectOnAbort();
        return;
      }
      init?.signal?.addEventListener("abort", rejectOnAbort, { once: true });
      handler(input, init).then(resolve, reject);
    });

const hangingFetch = () =>
  abortableFetch(() => new Promise<Response>(() => {}));

const client = (fetch: unknown, timeoutMs = 5000) =>
  new JevClient({
    apiKey: API_KEY,
    fetch: fetch as never,
    model: "jev-test",
    timeoutMs,
    transport: "typesafe",
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
    const result = await client((url: string, init?: RequestInit) => {
      captured = { init, url };
      return Promise.resolve(jsonResponse(validBody));
    }).ask(state, { proceed: noul("Proceed?") });
    expect(result.answers.proceed).toBeDefined();
    expect(captured?.url).toBe("https://api.typesafe.ai/v1/systemone");
    const headers = captured?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(String(captured?.init?.body)).model).toBe("jev-test");
  });

  test("prefixes OpenRouter models without a namespace", async () => {
    let capturedBody = "";
    const openRouterClient = new JevClient({
      apiKey: API_KEY,
      fetch: (_url: string, init?: RequestInit) => {
        capturedBody = String(init?.body);
        return Promise.resolve(jsonResponse(validBody));
      },
      model: "jev-latest",
      timeoutMs: 5000,
      transport: "openrouter",
    });
    await openRouterClient.ask(state, { proceed: noul("Proceed?") });
    expect(JSON.parse(capturedBody).model).toBe("~typesafe/jev-latest");
  });

  test("keeps a fully-qualified OpenRouter model id as-is", async () => {
    let capturedBody = "";
    const openRouterClient = new JevClient({
      apiKey: API_KEY,
      fetch: (_url: string, init?: RequestInit) => {
        capturedBody = String(init?.body);
        return Promise.resolve(jsonResponse(validBody));
      },
      model: "typesafe/jev-1.13",
      timeoutMs: 5000,
      transport: "openrouter",
    });
    await openRouterClient.ask(state, { proceed: noul("Proceed?") });
    expect(JSON.parse(capturedBody).model).toBe("typesafe/jev-1.13");
  });

  test("classifies a 401 as auth without leaking key material", async () => {
    const failure = await client(() =>
      Promise.resolve(jsonResponse({ error: "invalid api key" }, 401))
    )
      .ask(state, { proceed: noul("Proceed?") })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JevFailure);
    expect((failure as JevFailure).category).toBe("auth");
    expect((failure as JevFailure).message).not.toContain(API_KEY);
  });

  test("lets the total deadline cancel a pending retry", async () => {
    let calls = 0;
    const failure = await client(
      abortableFetch(() => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? jsonResponse({ error: "slow down" }, 429)
            : jsonResponse(validBody)
        );
      }),
      150
    )
      .ask(state, { proceed: noul("Proceed?") })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JevFailure);
    expect((failure as JevFailure).category).toBe("timeout");
    expect((failure as JevFailure).message).toContain("150 ms");
    expect(calls).toBe(1);
  }, 10_000);

  test("times out a hanging fetch within the wall budget", async () => {
    const failure = await client(hangingFetch(), 100)
      .ask(state, { proceed: noul("Proceed?") })
      .catch((error: unknown) => error);
    expect((failure as JevFailure).category).toBe("timeout");
  }, 10_000);

  test("retries a 429 once and returns the second attempt's answers", async () => {
    let calls = 0;
    const result = await client(() => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? jsonResponse({ error: "slow down" }, 429)
          : jsonResponse(validBody)
      );
    }).ask(state, { proceed: noul("Proceed?") });
    expect(result.answers.proceed).toBeDefined();
    expect(calls).toBe(2);
  });

  test("does not retry a 401", async () => {
    let calls = 0;
    const failure = await client(() => {
      calls += 1;
      return Promise.resolve(jsonResponse({ error: "unauthorized" }, 401));
    })
      .ask(state, { proceed: noul("Proceed?") })
      .catch((error: unknown) => error);
    expect((failure as JevFailure).category).toBe("auth");
    expect(calls).toBe(1);
  });

  test("classifies malformed responses", async () => {
    const failure = await client(async () =>
      jsonResponse({ answers: "garbage", model: "jev-test", usage: {} })
    )
      .ask(state, { proceed: noul("Proceed?") })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JevFailure);
    expect((failure as JevFailure).category).toBe("malformed");
  });

  test("classifies non-JSON success responses as malformed", async () => {
    const failure = await client(
      async () => new Response("<html>gateway</html>", { status: 200 })
    )
      .ask(state, { proceed: noul("Proceed?") })
      .catch((error: unknown) => error);
    expect((failure as JevFailure).category).toBe("malformed");
  });

  test("classifies validation errors as malformed", async () => {
    const failure = await client(() =>
      Promise.resolve(jsonResponse({ error: { message: "bad rubric" } }, 422))
    )
      .ask(state, { proceed: noul("Proceed?") })
      .catch((error: unknown) => error);
    expect((failure as JevFailure).category).toBe("malformed");
    expect((failure as JevFailure).message).toContain("bad rubric");
  });

  test("classifies connection failures as network and retries once", async () => {
    let calls = 0;
    const failure = await client(() => {
      calls += 1;
      return Promise.reject(new Error("ECONNREFUSED connection refused"));
    })
      .ask(state, { proceed: noul("Proceed?") })
      .catch((error: unknown) => error);
    expect((failure as JevFailure).category).toBe("network");
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

  test("treats missing usage as zero tokens rather than failing", async () => {
    const result = await client(() =>
      Promise.resolve(
        jsonResponse({
          answers: { proceed: { noul: 0.5, type: "noul" } },
          model: "jev-test",
        })
      )
    ).ask(state, { proceed: noul("Proceed?") });
    expect(result.usage).toEqual({ cost: 0, inputTokens: 0, outputTokens: 0 });
  });
});
