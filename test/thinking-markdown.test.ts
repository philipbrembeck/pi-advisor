import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderThinkingMarkdown } from "../src/tools.ts";

initTheme();

const theme = {
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
};

describe("Advisor thinking Markdown rendering", () => {
  // Isolate the agent dir so the developer's real hide_thinking setting cannot collapse thinking previews.
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  beforeEach(() => {
    process.env.PI_CODING_AGENT_DIR = mkdtempSync(
      join(tmpdir(), "pi-advisor-thinking-")
    );
  });
  afterEach(() => {
    rmSync(process.env.PI_CODING_AGENT_DIR as string, {
      force: true,
      recursive: true,
    });
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  });

  test("renders incomplete thinking Markdown within narrow widths", () => {
    const component = renderThinkingMarkdown(
      "**Reviewing\n\n```ts\nconst next = 1",
      theme
    );
    const rendered = component.render(24);
    const plain = rendered.map(stripTerminalSequences).join("\n");

    expect(rendered.length).toBeGreaterThan(0);
    expect(plain).toContain("Reviewing");
    expect(plain).toContain("const next");
    expect(
      rendered.every((line) => visibleWidth(stripTerminalSequences(line)) <= 24)
    ).toBe(true);
  });

  test("accepts transient incomplete Markdown during streaming", () => {
    const incomplete = renderThinkingMarkdown("**Incomplete bold", theme);
    const plain = incomplete.render(80).map(stripTerminalSequences).join("\n");

    // During streaming, raw markers appear transiently (expected behavior).
    // When thinking completes, they will render properly.
    expect(plain).toContain("Incomplete bold");
  });

  test("renders completed Markdown thinking without raw markers", () => {
    const complete = renderThinkingMarkdown("**Completed bold**", theme);
    const plain = complete.render(80).map(stripTerminalSequences).join("\n");

    expect(plain).toContain("Completed bold");
    // Once delimiters close, markers don't appear
    expect(plain).not.toContain("**Completed");
  });
});
