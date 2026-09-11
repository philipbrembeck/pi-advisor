import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { GitContextLevel } from "../git.js";
import type { ManualAdvisorDialogView } from "./types.js";

const MANUAL_GIT_CONTEXT_COPY: Record<
  GitContextLevel,
  { description: string; label: string }
> = {
  full: { description: "summary plus patch", label: "Full" },
  off: { description: "no Git data", label: "None" },
  summary: { description: "changed paths and status", label: "Summary" },
};

export const renderManualAdvisorDialog = (
  view: ManualAdvisorDialogView
): string[] => {
  const {
    actionIndex,
    editorLines,
    focusTarget,
    gitContext,
    gitIndex,
    gitLevels,
    horizontalPadding,
    renderWidth,
    theme,
  } = view;
  const innerWidth = Math.max(0, renderWidth - 2);
  const contentWidth = Math.max(0, innerWidth - horizontalPadding * 2);
  const lines: string[] = [];

  const focusMarker = (target: ManualAdvisorDialogView["focusTarget"]) =>
    focusTarget === target ? theme.fg("accent", "▸ ") : "  ";
  const addLine = (text: string) => {
    if (renderWidth < 2) {
      lines.push(truncateToWidth(text, renderWidth, ""));
      return;
    }
    lines.push(
      `${theme.fg("border", "│")}${" ".repeat(
        horizontalPadding
      )}${truncateToWidth(text, contentWidth, "", true)}${" ".repeat(
        horizontalPadding
      )}${theme.fg("border", "│")}`
    );
  };
  const addWrapped = (
    text: string,
    color: "accent" | "text" | "muted" | "dim" = "text"
  ) => {
    const content = theme.fg(color, text);
    const wrapped = wrapTextWithAnsi(content, Math.max(1, contentWidth - 2));
    for (const line of wrapped.length > 0 ? wrapped : [""]) {
      addLine(`  ${line}`);
    }
  };

  if (renderWidth >= 2) {
    const title = truncateToWidth(
      " Ask Advisor ",
      Math.max(0, innerWidth),
      "",
      false
    );
    const titleWidth = visibleWidth(title);
    const remaining = Math.max(0, innerWidth - titleWidth);
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    lines.push(
      theme.fg("border", `╭${"─".repeat(left)}`) +
        theme.fg("accent", title) +
        theme.fg("border", `${"─".repeat(right)}╮`)
    );
    addLine("");
  }

  addLine(
    `${focusMarker("editor")}${theme.bold("Message for Advisor (optional)")}`
  );
  for (const editorLine of editorLines) {
    addLine(editorLine);
  }
  addLine("");
  addWrapped(
    "Automatic context follows your settings: conversation history, tool disclosure, project preferences, redaction, and configured limits remain unchanged.",
    "muted"
  );
  addWrapped(
    "This dialog does not expose drafts or explicit file handoff controls.",
    "dim"
  );
  addWrapped(
    "Git None only withholds repository data; it does not remove configured conversation history.",
    "dim"
  );
  addLine("");
  const gitCeiling = MANUAL_GIT_CONTEXT_COPY[gitContext].label;
  addLine(
    `${focusMarker("git")}${theme.bold(
      `Git repository context (max: ${gitCeiling}; ↑/↓ or Space to choose)`
    )}`
  );
  for (let index = 0; index < gitLevels.length; index += 1) {
    const level = gitLevels[index];
    const copy = MANUAL_GIT_CONTEXT_COPY[level];
    const selected = index === gitIndex;
    const marker = selected ? "●" : "○";
    const optionFocus = focusTarget === "git" && selected ? "▸ " : "  ";
    const color = selected ? "accent" : "text";
    addWrapped(
      `${optionFocus}${marker} ${copy.label} — ${copy.description}`,
      color
    );
  }
  addLine("");

  let interactionHint =
    "Enter submit · Shift+Enter newline · Tab/Shift+Tab focus · Esc cancel";
  if (focusTarget === "git") {
    interactionHint =
      "↑/↓ or Space choose · Enter next · Tab/Shift+Tab focus · Esc cancel";
  } else if (focusTarget === "actions") {
    interactionHint =
      "←/→ choose · Enter/Space activate · Tab/Shift+Tab focus · Esc cancel";
  }
  const submit = focusTarget === "actions" && actionIndex === 0;
  const submitLabel = submit
    ? theme.fg("accent", "[Submit]")
    : theme.fg("text", "[Submit]");
  const cancel = focusTarget === "actions" && actionIndex === 1;
  const cancelLabel = cancel
    ? theme.fg("accent", "[Cancel]")
    : theme.fg("text", "[Cancel]");
  addLine(`${focusMarker("actions")}${submitLabel}  ${cancelLabel}`);
  addWrapped(interactionHint, "dim");
  addLine("");

  if (renderWidth >= 2) {
    lines.push(
      theme.fg("border", `╰${"─".repeat(Math.max(0, renderWidth - 2))}╯`)
    );
  }
  return lines.map((line) => truncateToWidth(line, renderWidth, ""));
};
