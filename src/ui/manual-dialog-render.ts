import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import type { GitContextLevel } from "../git.ts";
import { t } from "../i18n.ts";
import type { ManualAdvisorDialogView } from "./types.ts";

interface GitContextCopy {
  description: string;
  label: string;
}

const gitContextCopy = (level: GitContextLevel): GitContextCopy => {
  switch (level) {
    case "full": {
      return {
        description: t("manualDialog.git.full.desc", "summary plus patch"),
        label: t("manualDialog.git.full.label", "Full"),
      };
    }

    case "off": {
      return {
        description: t("manualDialog.git.off.desc", "no Git data"),
        label: t("manualDialog.git.off.label", "None"),
      };
    }

    default: {
      return {
        description: t(
          "manualDialog.git.summary.desc",
          "changed paths and status"
        ),
        label: t("manualDialog.git.summary.label", "Summary"),
      };
    }
  }
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
      ` ${t("manualDialog.title", "Ask Advisor")} `,
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
    `${focusMarker("editor")}${theme.bold(
      t("manualDialog.messageLabel", "Message for Advisor (optional)")
    )}`
  );

  for (const editorLine of editorLines) {
    addLine(editorLine);
  }

  addLine("");
  addWrapped(
    t(
      "manualDialog.contextNote",
      "Automatic context follows your settings: conversation history, tool disclosure, project preferences, redaction, and configured limits remain unchanged."
    ),
    "muted"
  );
  addWrapped(
    t(
      "manualDialog.noDraftsNote",
      "This dialog does not expose drafts or explicit file handoff controls."
    ),
    "dim"
  );
  addWrapped(
    t(
      "manualDialog.gitNoneNote",
      "Git None only withholds repository data; it does not remove configured conversation history."
    ),
    "dim"
  );
  addLine("");

  const gitCeiling = gitContextCopy(gitContext).label;

  addLine(
    `${focusMarker("git")}${theme.bold(
      `${t("manualDialog.gitTitle", "Git repository context (max:")} ${
        gitCeiling
      }; ${t("manualDialog.gitChoose", "↑/↓ or Space to choose)")}`
    )}`
  );

  for (let index = 0; index < gitLevels.length; index += 1) {
    const level = gitLevels[index];
    const copy = gitContextCopy(level);
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

  let interactionHint = t(
    "manualDialog.hint.editor",
    "Enter submit · Shift+Enter newline · Tab/Shift+Tab focus · Esc cancel"
  );

  if (focusTarget === "git") {
    interactionHint = t(
      "manualDialog.hint.git",
      "↑/↓ or Space choose · Enter next · Tab/Shift+Tab focus · Esc cancel"
    );
  } else if (focusTarget === "actions") {
    interactionHint = t(
      "manualDialog.hint.actions",
      "←/→ choose · Enter/Space activate · Tab/Shift+Tab focus · Esc cancel"
    );
  }

  const submit = focusTarget === "actions" && actionIndex === 0;

  const submitLabel = submit
    ? theme.fg("accent", t("manualDialog.submit", "[Submit]"))
    : theme.fg("text", t("manualDialog.submit", "[Submit]"));

  const cancel = focusTarget === "actions" && actionIndex === 1;

  const cancelLabel = cancel
    ? theme.fg("accent", t("manualDialog.cancel", "[Cancel]"))
    : theme.fg("text", t("manualDialog.cancel", "[Cancel]"));

  const actionButtons = `${submitLabel}  ${cancelLabel}`;

  // Center the buttons in the content area; the 2-column focus marker sits
  // left of the computed offset.
  const buttonOffset = Math.max(
    0,
    Math.floor((contentWidth - visibleWidth(actionButtons)) / 2) - 2
  );

  addLine(
    `${focusMarker("actions")}${" ".repeat(buttonOffset)}${actionButtons}`
  );
  addWrapped(interactionHint, "dim");
  addLine("");

  if (renderWidth >= 2) {
    lines.push(
      theme.fg("border", `╰${"─".repeat(Math.max(0, renderWidth - 2))}╯`)
    );
  }

  return lines.map((line) => truncateToWidth(line, renderWidth, ""));
};
