import { describe, expect, test } from "bun:test";
import {
  capToolResult,
  recentConversation,
  redactSecrets,
  textFrom,
} from "../src/conversation.js";

describe("Conversation Module", () => {
  test("textFrom should parse simple strings", () => {
    expect(textFrom("Hello World")).toBe("Hello World");
  });

  test("textFrom should parse block arrays with text parts", () => {
    const blocks = [
      { text: "Line 1", type: "text" },
      { data: "xyz", type: "image" },
      { text: "Line 2", type: "text" },
    ];
    expect(textFrom(blocks)).toBe("Line 1\n\nLine 2");
  });

  test("textFrom should handle empty or non-string gracefully", () => {
    expect(textFrom(null)).toBe("");
    expect(textFrom(undefined)).toBe("");
    expect(textFrom({})).toBe("");
  });

  test("recentConversation omits history when configured to zero", () => {
    const ctx = {
      sessionManager: {
        getBranch: () => [
          { message: { content: "keep out", role: "user" }, type: "message" },
        ],
      },
    } as any;
    expect(recentConversation(ctx, 0)).toBe("");
  });

  test("recentConversation keeps complete semantic entries and marks omitted older context", () => {
    const ctx = {
      sessionManager: {
        getBranch: () => [
          { message: { content: "old", role: "user" }, type: "message" },
          { message: { content: "new", role: "assistant" }, type: "message" },
        ],
      },
    } as any;
    const result = recentConversation(ctx, 12);
    expect(result).toContain("[Older context omitted: 1 complete entry]");
    expect(result).toContain("Executor: new");
    expect(result).not.toContain("ser: old");
  });

  test("oversized tool results preserve head and tail sections", () => {
    const result = capToolResult("one\ntwo\nthree\nfour\nfive", 3, 100);
    expect(result.truncated).toBe(true);
    expect(result.content).toContain("one");
    expect(result.content).toContain("five");
    expect(result.content).toContain("omitted tool-result section");
  });

  test("enforces byte and line caps without splitting Unicode", () => {
    const single = capToolResult("😀😀😀😀", 2, 4);
    expect(Buffer.byteLength(single.content, "utf8")).toBeLessThanOrEqual(4);
    expect(single.content.split("\n")).toHaveLength(1);
    expect(single.content).toBe("[...");
    const oversized = capToolResult("x".repeat(10_000), 10, 10);
    expect(Buffer.byteLength(oversized.content, "utf8")).toBeLessThanOrEqual(
      10
    );
    expect(oversized.content.split("\n")).toHaveLength(1);
    const ctx = {
      sessionManager: {
        getBranch: () => [
          {
            message: {
              content: "a\nb\nc\nd",
              role: "toolResult",
              toolName: "bash",
            },
            type: "message",
          },
        ],
      },
    } as any;
    const result = recentConversation(ctx, Number.MAX_SAFE_INTEGER, 2, 100);
    expect(result).toContain("[Tool Result for bash]");
    expect(result).toContain("a");
    expect(result).toContain("d");
  });

  test("redacts secrets from messages, tool arguments, and full results", () => {
    const secret = "AKIAABCDEFGHIJKLMNOP";
    const ctx = {
      sessionManager: {
        getBranch: () => [
          {
            message: { content: `token=${secret}`, role: "user" },
            type: "message",
          },
          {
            message: {
              content: [
                {
                  arguments: { token: secret },
                  name: "bash",
                  type: "toolCall",
                },
              ],
              role: "assistant",
            },
            type: "message",
          },
          {
            message: {
              content: `Bearer ${secret}`,
              role: "toolResult",
              toolName: "bash",
            },
            type: "message",
          },
        ],
      },
    } as any;
    const result = recentConversation(
      ctx,
      Number.MAX_SAFE_INTEGER,
      2000,
      50 * 1024,
      {},
      true
    );
    expect(result).not.toContain(secret);
    expect(result).toContain("[REDACTED SECRET]");
    expect(redactSecrets("password=hunter2")).not.toContain("hunter2");
    expect(redactSecrets('password="hunter2"')).toBe("[REDACTED SECRET]");
  });

  test("redacts every documented secret pattern without retaining the match", () => {
    const secrets = [
      "-----BEGIN PRIVATE KEY-----\nvery-private\n-----END PRIVATE KEY-----",
      "Bearer bearer-token-value",
      "api_key=api-key-value",
      "https://alice:password@example.test/path",
      "AKIAABCDEFGHIJKLMNOP",
      "aws_secret_access_key=cloud-secret-value",
    ];
    for (const secret of secrets) {
      const output = redactSecrets(secret);
      expect(output).toContain("[REDACTED SECRET]");
      expect(output).not.toContain("very-private");
      expect(output).not.toContain("bearer-token-value");
      expect(output).not.toContain("api-key-value");
      expect(output).not.toContain("cloud-secret-value");
      expect(output).not.toContain("alice:password");
    }
  });

  test("redacts complete secrets before applying tool-output limits", () => {
    const secret =
      "-----BEGIN PRIVATE KEY-----\nvery-private\n-----END PRIVATE KEY-----";
    const ctx = {
      sessionManager: {
        getBranch: () => [
          {
            message: { content: secret, role: "toolResult", toolName: "bash" },
            type: "message",
          },
        ],
      },
    } as any;
    const result = recentConversation(
      ctx,
      Number.MAX_SAFE_INTEGER,
      2,
      100,
      {},
      true
    );
    expect(result).toContain("[REDACTED SECRET]");
    expect(result).not.toContain("BEGIN PRIVATE KEY");
    expect(result).not.toContain("very-private");
    expect(result).not.toContain("END PRIVATE KEY");
  });

  test("tool policies default to full and omit protected call arguments and output", () => {
    const source = "private result bytes";
    const callArguments = "private call argument";
    const contextFor = (toolName: string) =>
      ({
        sessionManager: {
          getBranch: () => [
            {
              message: {
                content: [
                  {
                    arguments: { credential: callArguments },
                    name: toolName,
                    type: "toolCall",
                  },
                ],
                role: "assistant",
              },
              type: "message",
            },
            {
              message: { content: source, role: "toolResult", toolName },
              type: "message",
            },
          ],
        },
      }) as any;
    const full = recentConversation(
      contextFor("custom"),
      Number.MAX_SAFE_INTEGER,
      2000,
      50 * 1024,
      {}
    );
    expect(full).toContain(callArguments);
    expect(full).toContain(source);
    const summary = recentConversation(
      contextFor("bash"),
      Number.MAX_SAFE_INTEGER,
      2000,
      50 * 1024,
      { bash: "summary" }
    );
    expect(summary).toContain(
      "arguments omitted by Advisor tool policy: summary"
    );
    expect(summary).toContain("status: success");
    expect(summary).not.toContain(callArguments);
    expect(summary).not.toContain(source);
    const excluded = recentConversation(
      contextFor("deploy"),
      Number.MAX_SAFE_INTEGER,
      2000,
      50 * 1024,
      { deploy: "exclude" }
    );
    expect(excluded).toContain("excluded by Advisor tool policy");
    expect(excluded).not.toContain(callArguments);
    expect(excluded).not.toContain(source);
  });

  test("preserves representative conversation bytes with privacy defaults", () => {
    const ctx = {
      sessionManager: {
        getBranch: () => [
          { message: { content: "first", role: "user" }, type: "message" },
          {
            message: {
              content: [
                { text: "second", type: "text" },
                {
                  arguments: { command: "pwd" },
                  name: "bash",
                  type: "toolCall",
                },
              ],
              role: "assistant",
            },
            type: "message",
          },
          {
            message: { content: "out", role: "toolResult", toolName: "bash" },
            type: "message",
          },
        ],
      },
    } as any;
    expect(
      recentConversation(
        ctx,
        Number.MAX_SAFE_INTEGER,
        2000,
        50 * 1024,
        {},
        false
      )
    ).toBe(
      'User: first\n\nExecutor: second\n[Tool Call: bash({"command":"pwd"})]\n\n[Tool Result for bash] (output):\nout'
    );
  });

  test("ALL preserves the complete semantic branch", () => {
    const ctx = {
      sessionManager: {
        getBranch: () => [
          { message: { content: "first", role: "user" }, type: "message" },
          {
            message: {
              content: [
                { text: "second", type: "text" },
                {
                  arguments: { command: "pwd" },
                  name: "bash",
                  type: "toolCall",
                },
              ],
              role: "assistant",
            },
            type: "message",
          },
        ],
      },
    } as any;
    const result = recentConversation(
      ctx,
      Number.MAX_SAFE_INTEGER,
      2000,
      50 * 1024,
      {}
    );
    expect(result).toContain("User: first");
    expect(result).toContain('[Tool Call: bash({"command":"pwd"})]');
  });
});
