/* biome-ignore-all lint/performance/noAwaitInLoops: broker startup is intentionally serialized for isolation. */

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";

const BROKER_PATH = "bench/harbor/codex-broker.mjs";
const MODEL = "openai-codex/gpt-5.6-luna";
const BROKER_READY = /BENCH_CODEX_BROKER_PORT=(\d+)/;
const AUTH = {
  "openai-codex": {
    access: "access-token",
    accountId: "account-for-test",
    expires: Date.now() + 3_600_000,
    refresh: "refresh-token",
    type: "oauth",
  },
};

const EXPIRED_AUTH = {
  "openai-codex": {
    ...AUTH["openai-codex"],
    expires: Date.now() - 1_000,
  },
};

const listen = (server: ReturnType<typeof createServer>) =>
  new Promise<number>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolveListen((server.address() as AddressInfo).port)
    );
  });

const closeServer = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });

const waitForReady = (child: ReturnType<typeof spawn>) => {
  let output = "";
  child.stdout?.setEncoding("utf8");
  return new Promise<number>((resolveReady, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`broker did not become ready: ${output}`)),
      5000
    );
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      const match = output.match(BROKER_READY);
      if (match) {
        clearTimeout(timeout);
        resolveReady(Number(match[1]));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`broker exited before ready: ${code ?? "unknown"}`));
    });
  });
};

describe("host-side Codex OAuth broker", () => {
  test("keeps OAuth host-side, forwards zstd requests, and enforces the lease", async () => {
    const authPath = `${process.env.TMPDIR ?? "/tmp"}/pi-advisor-broker-auth-${process.pid}.json`;
    writeFileSync(authPath, `${JSON.stringify(AUTH)}\n`);
    let forwarded = 0;
    const upstream = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      if (
        request.url !== "/backend-api/codex/responses" ||
        request.headers.authorization !== "Bearer access-token" ||
        request.headers["chatgpt-account-id"] !== "account-for-test" ||
        request.headers["x-bench-proxy-token"] !== undefined ||
        request.headers["content-encoding"] !== "zstd"
      ) {
        response.writeHead(401);
        response.end();
        return;
      }
      expect(Buffer.concat(chunks).byteLength).toBeGreaterThan(0);
      forwarded += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
    });
    await new Promise<void>((resolveListen, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", resolveListen);
    });

    const upstreamPort = (upstream.address() as AddressInfo).port;
    const body = JSON.stringify({
      input: [{ content: "hello", role: "user" }],
      max_output_tokens: 1,
      model: MODEL,
    });
    const compressed = zstdCompressSync(Buffer.from(body));
    const inputRate = 10;
    const outputRate = 20;
    const requestCost =
      (Buffer.byteLength(body) * inputRate + outputRate) / 1_000_000;
    const broker = spawn("node", [BROKER_PATH], {
      env: {
        ...process.env,
        BENCH_ADVISOR_MODEL: "",
        BENCH_CODEX_AUTH_FILE: authPath,
        BENCH_CODEX_PROXY_TOKEN: "test-broker-token",
        BENCH_CODEX_UPSTREAM_URL: `http://127.0.0.1:${upstreamPort}/backend-api`,
        BENCH_EXECUTOR_MODEL: MODEL,
        BENCH_PROXY_PORT: "0",
        BENCH_TRIAL_BUDGET_USD: String(requestCost * 1.5),
        BENCH_TRIAL_PRICING_JSON: JSON.stringify({
          executor: {
            cacheReadPerMillion: 0,
            cacheWritePerMillion: 0,
            inputPerMillion: inputRate,
            outputPerMillion: outputRate,
          },
        }),
      },
      stdio: ["ignore", "pipe", "ignore"],
    });

    try {
      const port = await waitForReady(broker);
      const first = await fetch(`http://127.0.0.1:${port}/codex/responses`, {
        body: compressed,
        headers: {
          authorization: "Bearer dummy-jwt",
          "content-encoding": "zstd",
          "content-type": "application/json",
          "x-bench-proxy-token": "test-broker-token",
        },
        method: "POST",
      });
      const second = await fetch(`http://127.0.0.1:${port}/codex/responses`, {
        body: compressed,
        headers: {
          "content-encoding": "zstd",
          "content-type": "application/json",
          "x-bench-proxy-token": "test-broker-token",
        },
        method: "POST",
      });
      const unauthorized = await fetch(
        `http://127.0.0.1:${port}/codex/responses`,
        {
          body: compressed,
          headers: { "x-bench-proxy-token": "wrong" },
          method: "POST",
        }
      );
      expect(first.status).toBe(200);
      expect(second.status).toBe(402);
      expect(unauthorized.status).toBe(403);
    } finally {
      if (broker.exitCode === null) {
        broker.kill("SIGTERM");
        await once(broker, "exit");
      }
      await new Promise<void>((resolveClose, reject) => {
        upstream.close((error) => (error ? reject(error) : resolveClose()));
      });
      unlinkSync(authPath);
    }
    expect(forwarded).toBe(1);
  });

  test("a rotated refresh merges concurrent auth edits instead of overwriting", async () => {
    const authPath = join(
      process.env.TMPDIR ?? "/tmp",
      `pi-advisor-broker-merge-${process.pid}.json`
    );
    writeFileSync(authPath, `${JSON.stringify(EXPIRED_AUTH)}\n`);
    let refreshRequests = 0;
    const tokenServer = createServer((request, response) => {
      refreshRequests += 1;
      writeFileSync(
        authPath,
        `${JSON.stringify({
          "another-provider": { access: "other-provider-key" },
          ...EXPIRED_AUTH,
        })}\n`
      );
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          access_token: "rotated-access",
          expires_in: 3600,
          refresh_token: "rotated-refresh",
        })
      );
    });
    const tokenPort = await listen(tokenServer);

    const broker = spawn("node", [BROKER_PATH], {
      env: {
        ...process.env,
        BENCH_ADVISOR_MODEL: "",
        BENCH_CODEX_AUTH_FILE: authPath,
        BENCH_CODEX_PROXY_TOKEN: "test-broker-token",
        BENCH_CODEX_TOKEN_URL: `http://127.0.0.1:${tokenPort}/oauth/token`,
        BENCH_EXECUTOR_MODEL: MODEL,
        BENCH_PROXY_PORT: "0",
        BENCH_TRIAL_BUDGET_USD: "1",
        BENCH_TRIAL_PRICING_JSON: JSON.stringify({
          executor: {
            cacheReadPerMillion: 0,
            cacheWritePerMillion: 0,
            inputPerMillion: 1,
            outputPerMillion: 1,
          },
        }),
      },
      stdio: ["ignore", "pipe", "ignore"],
    });

    try {
      await waitForReady(broker);
      const persisted = JSON.parse(readFileSync(authPath, "utf8"));
      expect(refreshRequests).toBe(1);
      expect(persisted["another-provider"]).toEqual({
        access: "other-provider-key",
      });
      expect(persisted["openai-codex"]).toMatchObject({
        access: "rotated-access",
        accountId: "account-for-test",
        refresh: "rotated-refresh",
        type: "oauth",
      });
    } finally {
      if (broker.exitCode === null) {
        broker.kill("SIGTERM");
        await once(broker, "exit");
      }
      await closeServer(tokenServer);
      unlinkSync(authPath);
    }
  });

  test("a failed persist keeps the previous auth file and never activates rotated tokens", async () => {
    const authDir = mkdtempSync(join(tmpdir(), "pi-advisor-broker-fail-"));
    const authPath = join(authDir, "auth.json");
    writeFileSync(authPath, `${JSON.stringify(EXPIRED_AUTH)}\n`);
    const tokenServer = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          access_token: "rotated-access",
          expires_in: 3600,
          refresh_token: "rotated-refresh",
        })
      );
    });
    const tokenPort = await listen(tokenServer);
    chmodSync(authDir, 0o555);

    const broker = spawn("node", [BROKER_PATH], {
      env: {
        ...process.env,
        BENCH_ADVISOR_MODEL: "",
        BENCH_CODEX_AUTH_FILE: authPath,
        BENCH_CODEX_PROXY_TOKEN: "test-broker-token",
        BENCH_CODEX_TOKEN_URL: `http://127.0.0.1:${tokenPort}/oauth/token`,
        BENCH_EXECUTOR_MODEL: MODEL,
        BENCH_PROXY_PORT: "0",
        BENCH_TRIAL_BUDGET_USD: "1",
        BENCH_TRIAL_PRICING_JSON: JSON.stringify({
          executor: {
            cacheReadPerMillion: 0,
            cacheWritePerMillion: 0,
            inputPerMillion: 1,
            outputPerMillion: 1,
          },
        }),
      },
      stdio: ["ignore", "pipe", "ignore"],
    });

    try {
      await expect(waitForReady(broker)).rejects.toThrow(
        /exited before ready/u
      );
      expect(broker.exitCode).not.toBe(0);
      chmodSync(authDir, 0o755);
      const persisted = JSON.parse(readFileSync(authPath, "utf8"));
      expect(persisted["openai-codex"]).toMatchObject({
        access: "access-token",
        refresh: "refresh-token",
      });
      expect(
        readdirSync(authDir).filter((name) => name.includes(".tmp"))
      ).toEqual([]);
    } finally {
      chmodSync(authDir, 0o755);

      if (broker.exitCode === null) {
        broker.kill("SIGTERM");
        await once(broker, "exit");
      }

      await closeServer(tokenServer);
      rmSync(authDir, { force: true, recursive: true });
    }
  });
});
