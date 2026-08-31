/* biome-ignore-all lint/performance/noAwaitInLoops: proxy startup and cases are intentionally serialized. */

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const PROXY_PATH = "bench/harbor/budget-proxy.mjs";
const MODEL = "openai-codex/gpt-5.6-luna";

const freePort = async () => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
};

const waitForHealth = async (port: number) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) {
        return;
      }
    } catch {
      // The proxy may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Budget proxy did not become healthy.");
};

describe("Harbor budget proxy", () => {
  test("bounds supported output-limit forms and Unicode/tool payloads", async () => {
    let forwarded = 0;
    const upstream = createServer((request, response) => {
      if (
        request.url !== "/v1/chat/completions" ||
        request.headers.authorization !== "Bearer provider-secret" ||
        request.headers["api-key"] !== undefined ||
        request.headers["x-api-key"] !== undefined
      ) {
        response.writeHead(401);
        response.end();
        return;
      }
      forwarded += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"choices":[],"usage":{"total_tokens":2}}');
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", resolve);
    });

    try {
      const upstreamPort = (upstream.address() as AddressInfo).port;
      const limits: [string | undefined, number | undefined][] = [
        ["max_tokens", 3],
        ["max_completion_tokens", 3],
        ["max_output_tokens", 3],
        ["maxTokens", 3],
        [undefined, undefined],
      ];
      for (const [limitKey, limit] of limits) {
        const payload = {
          messages: [
            {
              content: "Unicode payload: café 東京 🧪",
              role: "user",
            },
          ],
          model: MODEL,
          tools: [
            {
              function: {
                description: "Return the requested value",
                name: "lookup_value",
                parameters: {
                  properties: { value: { type: "string" } },
                  type: "object",
                },
              },
              type: "function",
            },
          ],
          ...(limitKey ? { [limitKey]: limit } : {}),
        };
        const body = JSON.stringify(payload);
        const outputTokens = limit ?? 16_384;
        const requestCost =
          (Buffer.byteLength(body, "utf8") * 10 + outputTokens * 20) /
          1_000_000;
        const proxyPort = await freePort();
        const proxy = spawn("node", [PROXY_PATH], {
          env: {
            ...process.env,
            BENCH_API_KEY: "provider-secret",
            BENCH_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`,
            BENCH_EXECUTOR_MODEL: MODEL,
            BENCH_PROXY_PORT: String(proxyPort),
            BENCH_TRIAL_BUDGET_USD: String(requestCost * 1.5),
            BENCH_TRIAL_PRICING_JSON: JSON.stringify({
              executor: {
                cacheReadPerMillion: 0,
                cacheWritePerMillion: 0,
                inputPerMillion: 10,
                outputPerMillion: 20,
              },
            }),
          },
          stdio: ["ignore", "ignore", "ignore"],
        });
        try {
          await waitForHealth(proxyPort);
          const first = await fetch(
            `http://127.0.0.1:${proxyPort}/chat/completions`,
            {
              body,
              headers: {
                "api-key": "dummy",
                authorization: "Bearer dummy",
                "x-api-key": "dummy",
              },
              method: "POST",
            }
          );
          const second = await fetch(
            `http://127.0.0.1:${proxyPort}/chat/completions`,
            {
              body,
              headers: { authorization: "Bearer dummy" },
              method: "POST",
            }
          );
          expect(first.status).toBe(200);
          expect(second.status).toBe(402);
        } finally {
          if (proxy.exitCode === null) {
            proxy.kill("SIGTERM");
            await once(proxy, "exit");
          }
        }
      }
    } finally {
      upstream.close();
    }

    expect(forwarded).toBe(5);
  });
});
