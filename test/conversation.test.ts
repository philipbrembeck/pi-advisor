import { expect, test, describe } from "bun:test";
import { textFrom } from "../src/conversation.js";

describe("Conversation Module", () => {
  test("textFrom should parse simple strings", () => {
    expect(textFrom("Hello World")).toBe("Hello World");
  });

  test("textFrom should parse block arrays with text parts", () => {
    const blocks = [
      { type: "text", text: "Line 1" },
      { type: "image", data: "xyz" },
      { type: "text", text: "Line 2" }
    ];
    expect(textFrom(blocks)).toBe("Line 1\n\nLine 2");
  });

  test("textFrom should handle empty or non-string gracefully", () => {
    expect(textFrom(null)).toBe("");
    expect(textFrom(undefined)).toBe("");
    expect(textFrom({})).toBe("");
  });
});
