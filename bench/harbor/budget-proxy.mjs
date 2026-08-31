#!/usr/bin/env node

// Local OpenAI-compatible forwarding proxy. It reserves a conservative upper
// bound before forwarding each normal client request, so the provider never
// sees one after the trial's USD lease is exhausted. It intentionally emits no logs:
// request headers and bodies may contain credentials or repository content.
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: the proxy keeps the pre-forward budget gate and forwarding path together. */

const TRAILING_SLASHES = /\/+$/u;
const LEADING_SLASHES = /^[/]+/u;
const port = Number(process.env.BENCH_PROXY_PORT ?? "18765");
const budget = Number(process.env.BENCH_TRIAL_BUDGET_USD);
const credential = process.env.BENCH_API_KEY;
const upstreamBase = process.env.BENCH_BASE_URL;
const executorModel = process.env.BENCH_EXECUTOR_MODEL;
const advisorModel = process.env.BENCH_ADVISOR_MODEL;

const fail = (message) => {
  throw new Error(message);
};

if (!Number.isFinite(port) || port <= 0 || port >= 65_536) {
  fail("Invalid BENCH_PROXY_PORT");
}
if (!Number.isFinite(budget) || budget <= 0) {
  fail("Invalid BENCH_TRIAL_BUDGET_USD");
}
if (!credential) {
  fail("BENCH_API_KEY is required");
}
if (!upstreamBase) {
  fail("BENCH_BASE_URL is required");
}
let upstream;
try {
  upstream = new URL(upstreamBase);
} catch {
  fail("BENCH_BASE_URL must be an absolute URL");
}
if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
  fail("BENCH_BASE_URL must use http or https");
}

let pricing;
try {
  pricing = JSON.parse(process.env.BENCH_TRIAL_PRICING_JSON ?? "");
} catch {
  fail("BENCH_TRIAL_PRICING_JSON must be valid JSON");
}

const PRICE_KEYS = [
  "inputPerMillion",
  "outputPerMillion",
  "cacheReadPerMillion",
  "cacheWritePerMillion",
];

const validRates = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => PRICE_KEYS.includes(key)) &&
  PRICE_KEYS.every((key) => Number.isFinite(value[key]) && value[key] >= 0) &&
  PRICE_KEYS.some((key) => value[key] > 0);

const matchesModel = (model, reference) =>
  typeof model === "string" &&
  typeof reference === "string" &&
  (model === reference || model === reference.split("/").at(-1));

const rateForModel = (model) => {
  if (matchesModel(model, advisorModel) && validRates(pricing.advisor)) {
    return pricing.advisor;
  }
  if (matchesModel(model, executorModel) && validRates(pricing.executor)) {
    return pricing.executor;
  }
};

let reserved = 0;
const maxOutputTokens = (payload) => {
  for (const key of [
    "max_tokens",
    "max_completion_tokens",
    "max_output_tokens",
    "maxTokens",
  ]) {
    if (Object.hasOwn(payload, key)) {
      if (!Number.isSafeInteger(payload[key]) || payload[key] <= 0) {
        fail("Provider payload has an invalid output-token limit");
      }
      return payload[key];
    }
  }
  return 16_384;
};

const estimate = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("Provider payload must be an object");
  }
  const model = typeof payload.model === "string" ? payload.model : undefined;
  const rates = rateForModel(model);
  if (!rates) {
    fail("Provider payload model is not pinned or priced");
  }
  const bodyBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  const inputRate = Math.max(
    rates.inputPerMillion,
    rates.cacheReadPerMillion,
    rates.cacheWritePerMillion
  );
  const outputTokens = maxOutputTokens(payload);
  return (
    (bodyBytes * inputRate + outputTokens * rates.outputPerMillion) / 1_000_000
  );
};

const copyResponseHeaders = (headers) => {
  const result = {};
  for (const [key, value] of headers) {
    if (
      ![
        "connection",
        "content-encoding",
        "content-length",
        "transfer-encoding",
      ].includes(key.toLowerCase())
    ) {
      result[key] = value;
    }
  }
  return result;
};

const server = await import("node:http").then(({ createServer }) =>
  createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok\n");
      return;
    }
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString("utf8");
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("invalid provider payload\n");
      return;
    }

    let requestCost;
    try {
      requestCost = estimate(payload);
    } catch {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("unpriced or malformed provider payload\n");
      return;
    }
    if (
      !Number.isFinite(requestCost) ||
      reserved + requestCost > budget + Number.EPSILON
    ) {
      response.writeHead(402, { "content-type": "text/plain" });
      response.end("benchmark budget exhausted\n");
      return;
    }
    // Keep the conservative reservation for the whole trial. Releasing it on
    // response completion would allow a sequence of individually affordable
    // requests to exceed the global lease.
    reserved += requestCost;

    const incoming = new URL(request.url ?? "/", "http://127.0.0.1");
    const upstreamPath = upstream.pathname.replace(TRAILING_SLASHES, "");
    const incomingPath = incoming.pathname.startsWith(`${upstreamPath}/`)
      ? incoming.pathname
      : `${upstreamPath}/${incoming.pathname.replace(LEADING_SLASHES, "")}`;
    const target = new URL(`${incomingPath}${incoming.search}`, upstream);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");
    headers.delete("authorization");
    headers.delete("api-key");
    headers.delete("x-api-key");
    headers.set("authorization", `Bearer ${credential}`);
    try {
      const result = await fetch(target, {
        body,
        headers,
        method: request.method,
        redirect: "manual",
      });
      response.writeHead(result.status, copyResponseHeaders(result.headers));
      if (!result.body) {
        response.end();
        return;
      }
      for await (const chunk of result.body) {
        response.write(Buffer.from(chunk));
      }
      response.end();
    } catch {
      response.writeHead(502, { "content-type": "text/plain" });
      response.end("provider transport failed\n");
    }
  })
);

server.listen(port, "127.0.0.1");
