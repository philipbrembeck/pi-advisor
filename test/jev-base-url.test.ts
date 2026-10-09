import { describe, expect, test } from "bun:test";

import {
  jevSystemOneEndpoint,
  normalizeJevBaseUrl,
} from "../src/jev/base-url.ts";

const accepted: [string, string][] = [
  ["https://api.codiv.ai", "https://api.codiv.ai"],
  ["https://api.typesafe.ai/v1", "https://api.typesafe.ai"],
  [
    "https://my-model-server.example.com/v1/systemone",
    "https://my-model-server.example.com",
  ],
  ["https://api.codiv.ai/", "https://api.codiv.ai"],
  ["https://api.codiv.ai///", "https://api.codiv.ai"],
  ["https://gw.corp/llm/jev", "https://gw.corp/llm/jev"],
  ["https://gw.corp/llm/jev/v1", "https://gw.corp/llm/jev"],
  ["https://gw.corp/llm/jev/v1/systemone", "https://gw.corp/llm/jev"],
  ["https://jev.internal:8443", "https://jev.internal:8443"],
  ["http://localhost:11435", "http://localhost:11435"],
  ["http://127.0.0.1:8009/v1", "http://127.0.0.1:8009"],
  ["http://127.255.255.254:8009", "http://127.255.255.254:8009"],
  ["http://127.1:8009", "http://127.0.0.1:8009"],
  ["http://[::1]:8000", "http://[::1]:8000"],
  ["HTTPS://API.CODIV.AI/v1", "https://api.codiv.ai"],
  ["  https://api.codiv.ai/v1  ", "https://api.codiv.ai"],
];

const rejected = [
  "",
  "   ",
  "not a url",
  "api.codiv.ai",
  "ftp://api.codiv.ai",
  "http://jev.example.com",
  "http://192.168.1.10:8009",
  "http://127.pi.dev",
  "http://127.0.0.1.evil.com",
  "http://localhost.evil.com",
  "http://128.0.0.1:8009",
  "https://user:pass@api.codiv.ai",
  "https://user@api.codiv.ai",
  "https://api.codiv.ai?version=1",
  "https://api.codiv.ai#top",
];

describe("normalizeJevBaseUrl", () => {
  test("normalizes every accepted spelling to an origin plus optional path prefix", () => {
    for (const [input, expected] of accepted) {
      const result = normalizeJevBaseUrl(input);
      expect(result.baseUrl).toBe(expected);
      expect(result.error).toBeUndefined();
    }
  });

  test("rejects anything that cannot be an endpoint root", () => {
    for (const input of rejected) {
      const result = normalizeJevBaseUrl(input);
      expect(result.baseUrl).toBeUndefined();
      expect(result.error).toBeString();
    }
  });

  test("appends the System One path exactly once", () => {
    const base = normalizeJevBaseUrl("https://gw.corp/llm/jev/v1").baseUrl;
    expect(base).toBe("https://gw.corp/llm/jev");
    expect(jevSystemOneEndpoint(base ?? "")).toBe(
      "https://gw.corp/llm/jev/v1/systemone"
    );
  });

  test("keeps a loopback endpoint reachable over plain http", () => {
    const base = normalizeJevBaseUrl("http://localhost:11435").baseUrl;
    expect(jevSystemOneEndpoint(base ?? "")).toBe(
      "http://localhost:11435/v1/systemone"
    );
  });
});
