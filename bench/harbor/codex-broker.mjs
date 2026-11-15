#!/usr/bin/env node

// Host-side Codex OAuth broker for Harbor trials. The reusable OAuth tokens stay
// on the host; the task container receives only a dummy JWT and a per-trial
// broker token. This process intentionally emits no request, header, or body
// logs.
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: auth refresh, compressed request validation, and streaming proxying must stay in one fail-closed path. */

import {
  chmodSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { zstdDecompressSync } from "node:zlib";

const CODEX_UPSTREAM =
  process.env.BENCH_CODEX_UPSTREAM_URL?.trim() ||
  "https://chatgpt.com/backend-api";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_ACCOUNT_CLAIM = "https://api.openai.com/auth";
const READY_PREFIX = "BENCH_CODEX_BROKER_PORT=";
const TOKEN_HEADER = "x-bench-proxy-token";
const TRAILING_SLASHES = /\/+$/u;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const REFRESH_MARGIN_MS = 60_000;
const PRICE_KEYS = [
  "inputPerMillion",
  "outputPerMillion",
  "cacheReadPerMillion",
  "cacheWritePerMillion",
];

const fail = (message) => {
  throw new Error(message);
};

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`${name} is required`);
  }
  return value;
};

const positiveNumberEnv = (name) => {
  const value = Number(requiredEnv(name));
  if (!Number.isFinite(value) || value <= 0) {
    fail(`${name} must be finite and positive`);
  }
  return value;
};

const authPath = requiredEnv("BENCH_CODEX_AUTH_FILE");
const brokerToken = requiredEnv("BENCH_CODEX_PROXY_TOKEN");
const budget = positiveNumberEnv("BENCH_TRIAL_BUDGET_USD");
const executorModel = requiredEnv("BENCH_EXECUTOR_MODEL");
const advisorModel = process.env.BENCH_ADVISOR_MODEL?.trim() || undefined;
const configuredPort = Number(process.env.BENCH_PROXY_PORT ?? "0");
if (
  !Number.isInteger(configuredPort) ||
  configuredPort < 0 ||
  configuredPort >= 65_536
) {
  fail("BENCH_PROXY_PORT must be an integer from 0 through 65535");
}

let pricing;
try {
  pricing = JSON.parse(requiredEnv("BENCH_TRIAL_PRICING_JSON"));
} catch {
  fail("BENCH_TRIAL_PRICING_JSON must be valid JSON");
}

const validRates = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => PRICE_KEYS.includes(key)) &&
  PRICE_KEYS.every((key) => Number.isFinite(value[key]) && value[key] >= 0) &&
  PRICE_KEYS.some((key) => value[key] > 0);

if (!validRates(pricing?.executor)) {
  fail("executor pricing is missing, malformed, or zero");
}
if (advisorModel && !validRates(pricing?.advisor)) {
  fail("advisor pricing is missing, malformed, or zero");
}
if (
  advisorModel &&
  advisorModel === executorModel &&
  PRICE_KEYS.some((key) => pricing.advisor[key] !== pricing.executor[key])
) {
  fail("executor and Advisor cannot share a model with different pricing");
}

let auth;
try {
  auth = JSON.parse(readFileSync(authPath, "utf8"));
} catch {
  fail("BENCH_CODEX_AUTH_FILE is not valid JSON");
}
const credential = auth?.["openai-codex"];
if (
  credential?.type !== "oauth" ||
  typeof credential.access !== "string" ||
  !credential.access ||
  typeof credential.refresh !== "string" ||
  !credential.refresh ||
  typeof credential.expires !== "number" ||
  !Number.isFinite(credential.expires)
) {
  fail("BENCH_CODEX_AUTH_FILE has no usable openai-codex OAuth credential");
}

let accessToken = credential.access;
let refreshToken = credential.refresh;
let expiresAt = credential.expires;
let accountId =
  typeof credential.accountId === "string" && credential.accountId.trim()
    ? credential.accountId.trim()
    : undefined;
let refreshInFlight;

const decodeAccountId = (token) => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return;
    }
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    );
    const value = payload?.[CODEX_ACCOUNT_CLAIM]?.chatgpt_account_id;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    // The caller reports a generic missing-account error.
  }
};

accountId ??= decodeAccountId(accessToken);
if (!accountId) {
  fail("BENCH_CODEX_AUTH_FILE access token has no ChatGPT account id");
}

const persistAuth = () => {
  const temporaryPath = `${authPath}.bench-${process.pid}.tmp`;
  try {
    auth["openai-codex"] = {
      ...credential,
      access: accessToken,
      accountId,
      expires: expiresAt,
      refresh: refreshToken,
      type: "oauth",
    };
    writeFileSync(temporaryPath, `${JSON.stringify(auth, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, authPath);
    chmodSync(authPath, 0o600);
  } catch {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Keep the original failure generic and do not expose auth paths beyond
      // the already operator-selected file in a provider error.
    }
    fail("Codex OAuth refresh could not be persisted");
  }
};

const refreshAccessToken = async () => {
  let response;
  try {
    response = await fetch(CODEX_TOKEN_URL, {
      body: new URLSearchParams({
        client_id: CODEX_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
  } catch {
    fail("Codex OAuth refresh transport failed");
  }
  if (!response.ok) {
    fail("Codex OAuth refresh was rejected");
  }
  let value;
  try {
    value = await response.json();
  } catch {
    fail("Codex OAuth refresh returned malformed JSON");
  }
  if (
    !value ||
    typeof value.access_token !== "string" ||
    !value.access_token ||
    typeof value.refresh_token !== "string" ||
    !value.refresh_token ||
    typeof value.expires_in !== "number" ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0
  ) {
    fail("Codex OAuth refresh omitted required token fields");
  }
  accessToken = value.access_token;
  refreshToken = value.refresh_token;
  expiresAt = Date.now() + value.expires_in * 1000;
  accountId = decodeAccountId(accessToken) ?? accountId;
  persistAuth();
};

const ensureAccessToken = async (forceRefresh = false) => {
  if (
    !forceRefresh &&
    expiresAt > Date.now() + REFRESH_MARGIN_MS &&
    accessToken
  ) {
    return;
  }
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = undefined;
    });
  }
  await refreshInFlight;
};

await ensureAccessToken();

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

const maxOutputTokens = (payload) => {
  for (const key of [
    "max_output_tokens",
    "max_tokens",
    "max_completion_tokens",
    "maxTokens",
  ]) {
    if (Object.hasOwn(payload, key)) {
      if (!Number.isSafeInteger(payload[key]) || payload[key] <= 0) {
        fail("Codex payload has an invalid output-token limit");
      }
      return payload[key];
    }
  }
  return 16_384;
};

const decodeBody = (rawBody, encoding) => {
  const normalized = typeof encoding === "string" ? encoding.toLowerCase() : "";
  if (!normalized || normalized === "identity") {
    return rawBody;
  }
  if (normalized === "zstd") {
    try {
      return zstdDecompressSync(rawBody);
    } catch {
      fail("Codex request zstd body could not be decompressed");
    }
  }
  fail("Unsupported Codex request content encoding");
};

const estimate = (payload, bodyBytes) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("Codex payload must be an object");
  }
  const rates = rateForModel(payload.model);
  if (!rates) {
    fail("Codex payload model is not pinned or priced");
  }
  const inputRate = Math.max(
    rates.inputPerMillion,
    rates.cacheReadPerMillion,
    rates.cacheWritePerMillion
  );
  return (
    (bodyBytes * inputRate +
      maxOutputTokens(payload) * rates.outputPerMillion) /
    1_000_000
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

const collectBody = async (request) => {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) {
      fail("Codex request body is too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

let reserved = 0;

const forward = async (rawBody, incomingHeaders, forceRefresh = false) => {
  await ensureAccessToken(forceRefresh);
  const headers = new Headers(incomingHeaders);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("authorization");
  headers.delete(TOKEN_HEADER);
  headers.set("authorization", `Bearer ${accessToken}`);
  headers.set("chatgpt-account-id", accountId);
  headers.set("originator", "pi");
  return fetch(
    new URL(
      "codex/responses",
      `${CODEX_UPSTREAM.replace(TRAILING_SLASHES, "")}/`
    ),
    {
      body: rawBody,
      headers,
      method: "POST",
      redirect: "manual",
    }
  );
};

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok\n");
    return;
  }
  if (request.headers[TOKEN_HEADER] !== brokerToken) {
    response.writeHead(403, { "content-type": "text/plain" });
    response.end("benchmark broker authorization failed\n");
    return;
  }
  if (
    request.method !== "POST" ||
    new URL(request.url ?? "/", "http://127.0.0.1").pathname !==
      "/codex/responses"
  ) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found\n");
    return;
  }

  let rawBody;
  let decodedBody;
  let payload;
  try {
    rawBody = await collectBody(request);
    decodedBody = decodeBody(rawBody, request.headers["content-encoding"]);
    payload = JSON.parse(decodedBody.toString("utf8"));
  } catch {
    response.writeHead(400, { "content-type": "text/plain" });
    response.end("malformed Codex request\n");
    return;
  }

  let requestCost;
  try {
    requestCost = estimate(payload, decodedBody.byteLength);
  } catch {
    response.writeHead(400, { "content-type": "text/plain" });
    response.end("unpriced or malformed Codex request\n");
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
  reserved += requestCost;

  let upstream;
  try {
    upstream = await forward(rawBody, request.headers);
    if (upstream.status === 401) {
      await upstream.arrayBuffer().catch(() => undefined);
      upstream = await forward(rawBody, request.headers, true);
    }
  } catch {
    response.writeHead(502, { "content-type": "text/plain" });
    response.end("Codex provider transport failed\n");
    return;
  }

  response.writeHead(upstream.status, copyResponseHeaders(upstream.headers));
  if (!upstream.body) {
    response.end();
    return;
  }
  try {
    for await (const chunk of upstream.body) {
      response.write(Buffer.from(chunk));
    }
  } catch {
    response.destroy();
    return;
  }
  response.end();
});

server.on("upgrade", (request, socket) => {
  // Pi's Codex client retries this transport over SSE. Refusing the upgrade
  // avoids forwarding an unbudgeted opaque WebSocket frame stream.
  if (request.headers[TOKEN_HEADER] === brokerToken) {
    socket.end(
      "HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    );
  } else {
    socket.end(
      "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    );
  }
});

server.on("clientError", (_error, socket) => {
  socket.destroy();
});

server.listen(configuredPort, "0.0.0.0", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    fail("Codex broker did not bind to a TCP port");
  }
  process.stdout.write(`${READY_PREFIX}${address.port}\n`);
});
