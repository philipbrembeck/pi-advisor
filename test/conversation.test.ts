import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { recentConversation, textFrom } from "../src/conversation.ts";
import { redactSecrets } from "../src/redaction.ts";
import { capToolResult } from "../src/tool-result-cap.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";

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
    const ctx = asExtensionContext({
      sessionManager: {
        getBranch: () => [
          { message: { content: "keep out", role: "user" }, type: "message" },
        ],
      },
    });

    expect(recentConversation(ctx, 0)).toBe("");
  });

  test("legacy host fallback respects reset and compaction boundaries", () => {
    const ctx = asExtensionContext({
      sessionManager: {
        getBranch: () => [
          {
            id: "old",
            message: { content: "cleared private prompt", role: "user" },
            type: "message",
          },
          { id: "reset", type: "reset_boundary" },
          {
            id: "current",
            message: { content: "current request", role: "user" },
            type: "message",
          },
        ],
      },
    });

    const conversation = recentConversation(ctx);
    expect(conversation).not.toContain("cleared private prompt");
    expect(conversation).toContain("current request");
  });

  test("legacy host fallback applies the latest compaction boundary", () => {
    const ctx = asExtensionContext({
      sessionManager: {
        getBranch: () => [
          {
            id: "old",
            message: { content: "discarded private history", role: "user" },
            type: "message",
          },
          {
            id: "kept",
            message: { content: "retained request", role: "user" },
            type: "message",
          },
          {
            firstKeptEntryId: "kept",
            id: "compaction",
            parentId: null,
            summary: "safe summary",
            timestamp: "2026-01-01T00:00:00Z",
            tokensBefore: 1000,
            type: "compaction",
          },
          {
            id: "new",
            message: { content: "current work", role: "user" },
            type: "message",
          },
        ],
      },
    });

    const conversation = recentConversation(ctx);
    expect(conversation).not.toContain("discarded private history");
    expect(conversation).toContain("System Compaction Summary");
    expect(conversation).toContain("retained request");
    expect(conversation).toContain("current work");
  });

  test("recentConversation keeps complete semantic entries and marks omitted older context", () => {
    const ctx = asExtensionContext({
      sessionManager: {
        getBranch: () => [
          { message: { content: "old", role: "user" }, type: "message" },
          { message: { content: "new", role: "assistant" }, type: "message" },
        ],
      },
    });

    const result = recentConversation(ctx, 22);
    expect(result.length).toBeLessThanOrEqual(22);
    expect(result).toContain("[Older context");
    expect(result).not.toContain("User: old");
  });

  test("truncates a lone oversized newest entry within the full marker budget", () => {
    const ctx = asExtensionContext({
      sessionManager: {
        getBranch: () => [
          {
            message: { content: "x".repeat(200), role: "user" },
            type: "message",
          },
        ],
      },
    });

    const result = recentConversation(ctx, 60);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).not.toContain("complete entries");
    expect(result).toContain("User:");
  });

  test("budgets an omitted-context marker that consumes the whole cap", () => {
    const ctx = asExtensionContext({
      sessionManager: {
        getBranch: () => [
          { message: { content: "old", role: "user" }, type: "message" },
          { message: { content: "new", role: "user" }, type: "message" },
        ],
      },
    });

    const result = recentConversation(ctx, 10);
    expect(result).toHaveLength(10);
    expect(result).not.toContain("0 complete entries");
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
    expect(Buffer.byteLength(single.content, "utf-8")).toBeLessThanOrEqual(4);
    expect(single.content.split("\n")).toHaveLength(1);
    expect(single.content).toBe("[...");
    const oversized = capToolResult("x".repeat(10_000), 10, 10);
    expect(Buffer.byteLength(oversized.content, "utf-8")).toBeLessThanOrEqual(
      10
    );
    expect(oversized.content.split("\n")).toHaveLength(1);

    const ctx = asExtensionContext({
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
    });

    const result = recentConversation(ctx, Number.MAX_SAFE_INTEGER, 2, 100);
    expect(result).toContain("[Tool Result for bash]");
    expect(result).toContain("a");
    expect(result).toContain("d");
  });

  test("redacts secrets from messages, tool arguments, and full results", () => {
    const secret = "AKIAABCDEFGHIJKLMNOP";
    const password = 'prefix"secret-suffix';

    const ctx = asExtensionContext({
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
                  arguments: { password, token: secret },
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
    });

    const result = recentConversation(
      ctx,
      Number.MAX_SAFE_INTEGER,
      2000,
      50 * 1024,
      {},
      true
    );

    expect(result).not.toContain(secret);
    expect(result).not.toContain(password);
    expect(result).not.toContain("secret-suffix");
    expect(result).toContain("[REDACTED SECRET]");
    expect(redactSecrets("password=hunter2")).not.toContain("hunter2");
    expect(redactSecrets('{"password":"hunter2"}')).toBe("{[REDACTED SECRET]}");
    expect(redactSecrets('password="hunter2"')).toBe("[REDACTED SECRET]");
    expect(
      redactSecrets("OPENAI_API_KEY=sk-proj-sensitive-value")
    ).not.toContain("sk-proj-sensitive-value");
    expect(
      redactSecrets('{"OPENAI_API_KEY":"sk-proj-sensitive-value"}')
    ).not.toContain("sk-proj-sensitive-value");
    expect(redactSecrets("The password field is optional.")).toBe(
      "The password field is optional."
    );
    expect(redactSecrets('password="unterminated\nKeep this context.')).toBe(
      "[REDACTED SECRET]\nKeep this context."
    );
    expect(
      redactSecrets('password="first line\nsecond secret"\nKeep this context.')
    ).toBe("[REDACTED SECRET]\nKeep this context.");
    expect(redactSecrets('password="secret\nKeep "context')).toBe(
      "[REDACTED SECRET]context"
    );
    expect(redactSecrets('password="trailing\\\nKeep this context.')).toBe(
      "[REDACTED SECRET]\nKeep this context."
    );
    expect(redactSecrets("password='trailing\\\nKeep this context.")).toBe(
      "[REDACTED SECRET]\nKeep this context."
    );
    expect(redactSecrets('password="escaped \\" quote"')).toBe(
      "[REDACTED SECRET]"
    );
    expect(redactSecrets("password='escaped \\' quote'")).toBe(
      "[REDACTED SECRET]"
    );
    expect(redactSecrets('password="first\\\nsecond"')).toBe(
      "[REDACTED SECRET]"
    );
    expect(redactSecrets("password='first\\\u2028second'")).toBe(
      "[REDACTED SECRET]"
    );
    expect(redactSecrets('password="secret\rKeep context')).toBe(
      "[REDACTED SECRET]\rKeep context"
    );
    expect(redactSecrets("password='secret\\\rKeep context")).toBe(
      "[REDACTED SECRET]\rKeep context"
    );
    expect(redactSecrets('password="secret\r\nKeep context')).toBe(
      "[REDACTED SECRET]\r\nKeep context"
    );
    expect(redactSecrets('password="secret\u2028Keep context')).toBe(
      "[REDACTED SECRET]"
    );
    expect(redactSecrets("password='secret\\\u2029Keep context")).toBe(
      "[REDACTED SECRET]"
    );
    expect(redactSecrets('password="first\\\u2029second"')).toBe(
      "[REDACTED SECRET]"
    );
    expect(redactSecrets('password="trailing\\')).toBe("[REDACTED SECRET]");
    expect(redactSecrets("password='trailing\\")).toBe("[REDACTED SECRET]");
  });

  test("redacts unterminated quoted secrets without catastrophic backtracking", async () => {
    const moduleUrl = new URL("../src/redaction.ts", import.meta.url).href;

    const cases = [
      {
        input: `token = "${"\\".repeat(40)}\nKeep this context.`,
        expected: "[REDACTED SECRET]\nKeep this context.",
      },
      {
        input: `token = "${"\\".repeat(40_000)}\nKeep this context.`,
        expected: "[REDACTED SECRET]\nKeep this context.",
      },
      {
        input: `password='${"\\'".repeat(10_000)}\nKeep this context.`,
        expected: "[REDACTED SECRET]\nKeep this context.",
      },
      {
        input: 'token="value"\n'.repeat(4000),
        expected: "[REDACTED SECRET]\n".repeat(4000),
      },
      {
        input: "token x ".repeat(8000),
        expected: "token x ".repeat(8000),
      },
      {
        input: "-----BEGIN PRIVATE KEY-----\n".repeat(1000),
        expected: "[REDACTED SECRET]",
      },
      {
        input: `${"a".repeat(60_000)}:/not-a-url`,
        expected: `${"a".repeat(60_000)}:/not-a-url`,
      },
    ];

    const outdir = mkdtempSync(join(tmpdir(), "pi-advisor-redaction-"));

    try {
      const built = await Bun.build({
        entrypoints: [
          fileURLToPath(new URL("../src/redaction.ts", import.meta.url)),
        ],
        target: "node",
        format: "esm",
        outdir,
      });

      expect(built.success).toBe(true);

      const builtModule = pathToFileURL(built.outputs[0].path).href;

      const runtimes = [
        { executable: process.execPath, moduleUrl },
        { executable: "node", moduleUrl: builtModule },
      ];

      for (const runtime of runtimes) {
        for (const { input, expected } of cases) {
          const script = `import { redactSecrets } from ${JSON.stringify(runtime.moduleUrl)}; let input = ""; for await (const chunk of process.stdin) input += chunk; console.log(redactSecrets(JSON.parse(input)));`;

          const result = spawnSync(runtime.executable, ["-e", script], {
            encoding: "utf-8",
            input: JSON.stringify(input),
            timeout: 3000,
          });

          expect(result.error).toBeUndefined();
          expect(result.status).toBe(0);
          expect(result.stdout.slice(0, -1)).toBe(expected);
        }
      }
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  }, 30_000);

  test("fails closed for ambiguous assignments and PEM blocks", () => {
    for (const separator of ["\u2028", "\u2029"]) {
      for (const quote of ['"', "'"]) {
        expect(
          redactSecrets(`password=${quote}first${separator}secret-suffix`)
        ).toBe("[REDACTED SECRET]");
      }
    }

    expect(redactSecrets('password="unterminated\napi_key="REAL_SECRET"')).toBe(
      "[REDACTED SECRET]"
    );

    for (const input of [
      "token=Bearer abcdefghijkl",
      'password="Bearer abcdefghijkl"',
    ]) {
      expect(redactSecrets(input)).not.toContain("abcdefghijkl");
    }

    expect(
      redactSecrets(
        "before -----BEGIN PRIVATE KEY-----\nfirst-secret\n-----BEGIN PRIVATE KEY-----\nsecond-secret"
      )
    ).toBe("before [REDACTED SECRET]");
    expect(
      redactSecrets(
        "before -----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END EC PRIVATE KEY-----\nafter"
      )
    ).toBe("before [REDACTED SECRET]");
    expect(
      redactSecrets(
        "before -----BEGIN PRIVATE KEY-----\nouter\n-----BEGIN PRIVATE KEY-----\ninner\n-----END PRIVATE KEY-----\nouter\n-----END PRIVATE KEY----- after"
      )
    ).toBe("before [REDACTED SECRET] after");
  });

  test("omits oversized inputs before redaction or truncation", () => {
    expect(redactSecrets("x".repeat(65_536))).toBe("x".repeat(65_536));
    expect(redactSecrets(`password=${"x".repeat(65_536)}`)).toBe(
      "[Redaction omitted: input exceeds 65536 characters]"
    );

    const ctx = asExtensionContext({
      sessionManager: {
        getBranch: () => [
          {
            message: {
              content: `password=${"secret".repeat(11_000)}`,
              role: "toolResult",
              toolName: "bash",
            },
            type: "message",
          },
        ],
      },
    });

    const result = recentConversation(ctx, 100_000, 200, 100_000, {}, true);
    expect(result).toContain(
      "[Redaction omitted: input exceeds 65536 characters]"
    );
    expect(result).not.toContain("secretsecret");
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

    const ctx = asExtensionContext({
      sessionManager: {
        getBranch: () => [
          {
            message: { content: secret, role: "toolResult", toolName: "bash" },
            type: "message",
          },
        ],
      },
    });

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
      asExtensionContext({
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
      });

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
    const ctx = asExtensionContext({
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
    });

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
    const ctx = asExtensionContext({
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
    });

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
