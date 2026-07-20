import { describe, expect, test } from "bun:test";
import {
  capToolResult,
  recentConversation,
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

  test("does not split a Unicode or single semantic tool-result entry", () => {
    const single = capToolResult("😀😀😀😀", 2, 4);
    expect(single.content).toContain("😀😀😀😀");
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
    const result = recentConversation(ctx, Number.MAX_SAFE_INTEGER);
    expect(result).toContain("User: first");
    expect(result).toContain('[Tool Call: bash({"command":"pwd"})]');
  });
});
