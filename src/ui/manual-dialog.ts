import {
  type Component,
  Editor,
  type EditorTheme,
  type Focusable,
  Key,
  type Keybindings,
  type KeyId,
  matchesKey,
} from "@earendil-works/pi-tui";
import {
  clampGitContextLevel,
  GIT_CONTEXT_LEVELS,
  type GitContextLevel,
} from "../git.js";
import { renderManualAdvisorDialog } from "./manual-dialog-render.js";
import type {
  ManualAdvisorDialogOptions,
  ManualAdvisorFocus,
} from "./types.js";

// Keep the keybinding components separate from Socket's URL-string heuristic.
const TUI_INPUT_TAB: keyof Keybindings = ["tui", "input", "tab"].join(
  "."
) as keyof Keybindings;

/**
 * The small, deliberately non-persistent form used by `/advisor-manual`.
 *
 * The dialog owns only local input state. Callers decide when to consume a
 * budget or start a consultation after the submitted request is returned.
 */
export class ManualAdvisorDialog implements Component, Focusable {
  private readonly options: ManualAdvisorDialogOptions;
  private readonly editor: Editor;
  private readonly gitLevels: GitContextLevel[];
  private gitIndex: number;
  private actionIndex = 0;
  private focusTarget: ManualAdvisorFocus = "editor";
  private readonly state: { completed: boolean; focused: boolean } = {
    completed: false,
    focused: false,
  };

  get focused(): boolean {
    return this.state.focused;
  }

  set focused(value: boolean) {
    this.state.focused = value;
    this.updateEditorFocus();
    this.options.tui.requestRender();
  }

  constructor(options: ManualAdvisorDialogOptions) {
    this.options = options;
    // Show the configured default first, followed by progressively narrower
    // choices. That makes Down do the useful thing from the initial selection
    // while the configured level remains the hard ceiling.
    this.gitLevels = GIT_CONTEXT_LEVELS.filter(
      (level) => clampGitContextLevel(level, options.gitContext) === level
    ).reverse();
    this.gitIndex = Math.max(0, this.gitLevels.indexOf(options.gitContext));

    const editorTheme: EditorTheme = {
      borderColor: (text) => options.theme.fg("border", text),
      selectList: {
        description: (text) => options.theme.fg("muted", text),
        noMatch: (text) => options.theme.fg("warning", text),
        scrollInfo: (text) => options.theme.fg("dim", text),
        selectedPrefix: (text) => options.theme.fg("accent", text),
        selectedText: (text) => options.theme.fg("accent", text),
      },
    };
    this.editor = new Editor(options.tui, editorTheme);
    this.editor.setText(options.initialMessage ?? "");
    this.editor.onChange = () => options.tui.requestRender();
    this.editor.onSubmit = (message) => this.submit(message);
    this.updateEditorFocus();
  }

  invalidate(): void {
    this.editor.invalidate();
  }

  dispose(): void {
    this.state.completed = true;
  }

  handleInput(keyData: string): void {
    if (this.state.completed) {
      return;
    }
    if (this.isCancel(keyData)) {
      this.cancel();
      return;
    }
    if (this.isShiftTab(keyData)) {
      this.changeFocus(-1);
      return;
    }
    if (this.isTab(keyData)) {
      this.changeFocus(1);
      return;
    }

    switch (this.focusTarget) {
      case "editor":
        // Editor owns Enter/Shift+Enter and all cursor/editing semantics. Its
        // onSubmit callback above is the sole editor submission path. At the
        // edge of the message, a directional key also moves to the adjacent
        // form control so the Git selector is reachable without Tab.
        this.handleEditorInput(keyData);
        return;
      case "git":
        this.handleGitInput(keyData);
        return;
      case "actions":
        this.handleActionInput(keyData);
        return;
      default:
        return;
    }
  }

  render(width: number): string[] {
    const renderWidth = Math.max(1, Math.floor(width));
    const innerWidth = Math.max(0, renderWidth - 2);
    const horizontalPadding = renderWidth >= 4 ? 1 : 0;
    const contentWidth = Math.max(0, innerWidth - horizontalPadding * 2);
    return renderManualAdvisorDialog({
      actionIndex: this.actionIndex,
      editorLines: this.editor.render(Math.max(1, contentWidth)),
      focusTarget: this.focusTarget,
      gitContext: this.options.gitContext,
      gitIndex: this.gitIndex,
      gitLevels: this.gitLevels,
      horizontalPadding,
      renderWidth,
      theme: this.options.theme,
    });
  }

  private handleEditorInput(keyData: string): void {
    let direction: -1 | 1 | undefined;
    if (this.matches(keyData, "tui.editor.cursorDown", Key.down)) {
      direction = 1;
    } else if (this.matches(keyData, "tui.editor.cursorUp", Key.up)) {
      direction = -1;
    }

    const beforeCursor =
      direction === undefined ? undefined : this.editor.getCursor();
    const beforeText =
      direction === undefined ? undefined : this.editor.getText();
    this.editor.handleInput(keyData);

    if (direction !== undefined) {
      const afterCursor = this.editor.getCursor();
      if (
        beforeCursor?.line === afterCursor.line &&
        beforeCursor.col === afterCursor.col &&
        beforeText === this.editor.getText()
      ) {
        this.changeFocus(direction);
        return;
      }
    }
    this.options.tui.requestRender();
  }

  private handleGitInput(keyData: string): void {
    // Accept both the selector bindings and the editor arrow bindings. The
    // latter keeps the form usable with user keymaps that customize selector
    // actions, while the raw-key fallback keeps terminal arrow sequences
    // working across Pi/pi-tui versions.
    const up =
      this.matches(keyData, "tui.select.up", Key.up) ||
      this.matches(keyData, "tui.editor.cursorUp", Key.up);
    const down =
      this.matches(keyData, "tui.select.down", Key.down) ||
      this.matches(keyData, "tui.editor.cursorDown", Key.down);
    if (up) {
      if (this.gitIndex === 0) {
        this.changeFocus(-1);
      } else {
        this.moveGit(-1);
      }
      return;
    }
    if (down) {
      if (this.gitIndex === this.gitLevels.length - 1) {
        this.changeFocus(1);
      } else {
        this.moveGit(1);
      }
      return;
    }
    if (matchesKey(keyData, Key.space)) {
      this.moveGit(1);
      return;
    }
    if (this.matches(keyData, "tui.input.submit", Key.enter)) {
      this.changeFocus(1);
      return;
    }
    this.options.tui.requestRender();
  }

  private handleActionInput(keyData: string): void {
    if (this.matches(keyData, "tui.editor.cursorUp", Key.up)) {
      this.changeFocus(-1);
      return;
    }
    if (this.matches(keyData, "tui.editor.cursorDown", Key.down)) {
      this.changeFocus(1);
      return;
    }
    if (matchesKey(keyData, Key.left) || matchesKey(keyData, Key.right)) {
      this.actionIndex = this.actionIndex === 0 ? 1 : 0;
      this.options.tui.requestRender();
      return;
    }
    if (
      this.matches(keyData, "tui.input.submit", Key.enter) ||
      matchesKey(keyData, Key.space)
    ) {
      if (this.actionIndex === 0) {
        this.submit();
      } else {
        this.cancel();
      }
    }
  }

  private changeFocus(direction: -1 | 1): void {
    const targets: ManualAdvisorFocus[] = ["editor", "git", "actions"];
    const current = targets.indexOf(this.focusTarget);
    this.focusTarget =
      targets[(current + direction + targets.length) % targets.length];
    this.updateEditorFocus();
    this.options.tui.requestRender();
  }

  private moveGit(direction: -1 | 1): void {
    if (this.gitLevels.length > 0) {
      this.gitIndex =
        (this.gitIndex + direction + this.gitLevels.length) %
        this.gitLevels.length;
    }
    this.options.tui.requestRender();
  }

  private updateEditorFocus(): void {
    this.editor.focused = this.state.focused && this.focusTarget === "editor";
  }

  private isTab(keyData: string): boolean {
    return (
      this.matches(keyData, TUI_INPUT_TAB, Key.tab) &&
      !matchesKey(keyData, Key.shift("tab"))
    );
  }

  private isShiftTab(keyData: string): boolean {
    return matchesKey(keyData, Key.shift("tab"));
  }

  private isCancel(keyData: string): boolean {
    return (
      matchesKey(keyData, Key.escape) ||
      this.options.keybindings.matches(keyData, "tui.select.cancel")
    );
  }

  private matches(
    keyData: string,
    action: keyof Keybindings,
    fallback: KeyId
  ): boolean {
    return (
      this.options.keybindings.matches(keyData, action) ||
      matchesKey(keyData, fallback)
    );
  }

  private submit(message = this.editor.getText()): void {
    if (this.state.completed) {
      return;
    }
    this.state.completed = true;
    this.options.onSubmit({
      gitContext: this.gitLevels[this.gitIndex] ?? "off",
      ...(message ? { message } : {}),
    });
  }

  private cancel(): void {
    if (this.state.completed) {
      return;
    }
    this.state.completed = true;
    this.options.onCancel();
  }
}
