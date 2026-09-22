import { describe, expect, test } from "bun:test";

import { LiveModelClient } from "../src/live-client.ts";
import { MockProviderServer } from "../src/replay/mock-provider.ts";
import type { ModelPin } from "../src/types.ts";

const pin: ModelPin = { effort: "high", model: "zai/glm-5.3", role: "advisor" };

const clientConfig = (baseUrl: string) => ({
  api: "openai-completions" as const,
  apiKey: "local-test-key",
  baseUrl,
  provider: "zai",
  timeoutMs: 30_000,
});

describe("live model client unusable-response policy", () => {
  test("retries once on empty text and records first-attempt evidence", async () => {
    let calls = 0;
    const server = await new MockProviderServer({
      replyFor: () => {
        calls += 1;
        return calls === 1
          ? { text: "" }
          : { text: "usable advice", usage: { input: 1, output: 2 } };
      },
    }).start();
    try {
      const client = new LiveModelClient(clientConfig(server.baseUrl));
      const result = await client.text({
        pin,
        prompt: "review the draft",
        systemPrompt: "sys",
      });
      expect(result.attempts).toBe(2);
      expect(result.text).toBe("usable advice");
      expect(result.firstEmpty?.stopReason).toBe("stop");
      expect(client.requests).toHaveLength(2);
      for (const request of client.requests) {
        expect(request.model).toBe("glm-5.3");
        expect(request.effort).toBe("high");
      }
    } finally {
      await server.close();
    }
  });

  test("returns empty text with evidence when both attempts are empty", async () => {
    const server = await new MockProviderServer({
      replyFor: () => ({ text: "" }),
    }).start();
    try {
      const client = new LiveModelClient(clientConfig(server.baseUrl));
      const result = await client.text({
        pin,
        prompt: "review the draft",
        systemPrompt: "sys",
      });
      expect(result.attempts).toBe(2);
      expect(result.text).toBe("");
      expect(result.firstEmpty?.partTypes).toBe("");
      expect(result.firstEmpty?.stopReason).toBe("stop");
    } finally {
      await server.close();
    }
  });

  test("does not retry when the first attempt returns text", async () => {
    let calls = 0;
    const server = await new MockProviderServer({
      replyFor: () => {
        calls += 1;
        return { text: "immediately usable" };
      },
    }).start();
    try {
      const client = new LiveModelClient(clientConfig(server.baseUrl));
      const result = await client.text({
        pin,
        prompt: "review the draft",
        systemPrompt: "sys",
      });
      expect(result.attempts).toBe(1);
      expect(result.firstEmpty).toBeUndefined();
      expect(calls).toBe(1);
      expect(client.requests).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});
