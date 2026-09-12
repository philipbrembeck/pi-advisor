import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  Markdown,
  Text,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { advisorCollapseResponsesRef } from "../config/state.ts";

export const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
];

const THINKING_PREFIX = "  💭 ";
const THINKING_PREFIX_WIDTH = visibleWidth(THINKING_PREFIX);
export type ThinkingTheme = Pick<Theme, "fg">;

/**
 * Renders visible nested-model thinking with the same Markdown semantics as
 * Pi's assistant thinking blocks while keeping the compact speech-bubble cue.
 * The prefix is added after Markdown parsing so it cannot change block syntax.
 *
 * Note: During streaming, incomplete Markdown (e.g., `**text` without closing **)
 * displays raw markers transiently until delimiters arrive. This mirrors expected
 * behavior when typing Markdown incrementally and is acceptable in the context
 * of brief thinking previews. When thinking is complete, all markers render.
 */
class ThinkingMarkdown implements Component {
  private readonly markdown: Markdown;
  private readonly prefix: string;

  constructor(thinking: string, theme: ThinkingTheme) {
    this.markdown = new Markdown(thinking.trim(), 0, 0, getMarkdownTheme(), {
      color: (text) => theme.fg("thinkingText", text),
      italic: true,
    });
    this.prefix = theme.fg("thinkingText", THINKING_PREFIX);
  }

  render(width: number): string[] {
    const renderWidth = Math.max(1, Math.floor(width));
    const contentWidth = Math.max(1, renderWidth - THINKING_PREFIX_WIDTH);
    const lines = this.markdown.render(contentWidth);
    return lines.map((line, index) =>
      truncateToWidth(
        index === 0 ? `${this.prefix}${line}` : line,
        renderWidth,
        ""
      )
    );
  }

  invalidate(): void {
    this.markdown.invalidate();
  }
}

export const renderThinkingMarkdown = (
  thinking: string,
  theme: ThinkingTheme
): Component => new ThinkingMarkdown(thinking, theme);

export const resolveAdvisorRequest = (question?: string) =>
  question?.trim() || undefined;

export const renderAdvisorCallBox = (
  question: string | undefined,
  theme: Theme
) => {
  const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
  const label = theme.fg("customMessageLabel", theme.bold("[advisor]"));
  const title = theme.fg("customMessageText", "Executor → Advisor");
  box.addChild(
    new Text(
      question
        ? `${label} ${title}\n${theme.fg("dim", `  ${question}`)}`
        : `${label} ${title}`,
      0,
      0
    )
  );
  return box;
};

const COLLAPSED_ADVICE_LINES = 12;
// The system prompt requires this exact first line, so the match is exact too.
const SOUND_VERDICT = /^Verdict:\s*sound$/;

export const hasSoundVerdict = (advice: string) =>
  SOUND_VERDICT.test(
    (advice.split("\n").find((line) => line.trim()) ?? "").trim()
  );

/** The single Advisor response header shared by tool and manual renderers. */
export const renderAdvisorResponseHeader = (sound: boolean, theme: Theme) =>
  sound
    ? theme.fg("accent", theme.bold("◆ ADVISOR · SOUND"))
    : theme.fg("warning", theme.bold("◆ ADVISOR RESPONSE"));

export const adviceForDisplay = (advice: string, expanded: boolean) => {
  if (!advisorCollapseResponsesRef || expanded) {
    return advice;
  }
  const lines = advice.split("\n");
  if (lines.length <= COLLAPSED_ADVICE_LINES) {
    return advice;
  }
  return `${lines.slice(0, COLLAPSED_ADVICE_LINES).join("\n")}\n\n… (${lines.length - COLLAPSED_ADVICE_LINES} more lines, Ctrl+O to expand)`;
};
