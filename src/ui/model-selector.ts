import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Focusable,
  fuzzyFilter,
  Input,
  type Keybindings,
  type KeybindingsManager,
} from "@earendil-works/pi-tui";
import type { SearchableModelSelectorOptions } from "./types.js";

export class SearchableModelSelector implements Component, Focusable {
  private readonly tui: SearchableModelSelectorOptions["tui"];
  private readonly searchInput: Input;
  private readonly allOptions: string[];
  private readonly currentOption: string | undefined;
  private filteredOptions: string[];
  private selectedIndex = 0;
  private readonly title: string;
  private readonly onSelect: (value: string) => void;
  private readonly onCancel: () => void;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }
  set focused(val: boolean) {
    this._focused = val;
    this.searchInput.focused = val;
  }

  constructor(options: SearchableModelSelectorOptions) {
    this.tui = options.tui;
    this.title = options.title;
    this.currentOption =
      options.currentOption &&
      options.allOptions.includes(options.currentOption)
        ? options.currentOption
        : undefined;
    this.allOptions = this.currentOption
      ? [
          this.currentOption,
          ...options.allOptions.filter((item) => item !== this.currentOption),
        ]
      : options.allOptions;
    this.theme = options.theme;
    this.keybindings = options.keybindings;
    this.onSelect = options.onSelect;
    this.onCancel = options.onCancel;
    this.searchInput = new Input();
    this.filteredOptions = this.allOptions;
  }

  invalidate(): void {
    this.searchInput.invalidate();
  }

  render(width: number): string[] {
    const lines: string[] = ["═".repeat(width)];
    lines.push(`  ${this.theme.fg("accent", this.theme.bold(this.title))}`);
    const inputLines = this.searchInput.render(width - 12);
    lines.push(
      `  ${this.theme.fg("accent", "Search: ")}${inputLines[0] || ""}`
    );
    lines.push("");

    const query = this.searchInput.getValue().trim();
    this.filteredOptions = query
      ? fuzzyFilter(this.allOptions, query, (item) => item)
      : this.allOptions;
    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filteredOptions.length - 1)
    );

    const maxVisible = 10;
    const total = this.filteredOptions.length;
    if (total === 0) {
      lines.push(`  ${this.theme.fg("muted", "No matching models found.")}`);
    } else {
      const startIndex = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(maxVisible / 2),
          total - maxVisible
        )
      );
      const endIndex = Math.min(startIndex + maxVisible, total);
      for (let i = startIndex; i < endIndex; i += 1) {
        const item = this.filteredOptions[i];
        const tick = item === this.currentOption ? "✓ " : "  ";
        if (i === this.selectedIndex) {
          lines.push(
            `  ${this.theme.fg("accent", "→ ")}${this.theme.fg("accent", `${tick}${item}`)}`
          );
        } else {
          lines.push(`    ${this.theme.fg("text", `${tick}${item}`)}`);
        }
      }
      if (total > maxVisible) {
        lines.push(
          "  " +
            this.theme.fg("muted", `  (${this.selectedIndex + 1}/${total})`)
        );
      }
    }
    lines.push("");
    lines.push(
      `  ${this.theme.fg("muted", "Type to search · ↑↓: navigate · Enter: select · Esc: cancel")}`
    );
    lines.push("═".repeat(width));
    return lines;
  }

  handleInput(keyData: string): void {
    if (this.matchesAction(keyData, "tui.select.up", "\u001b[A")) {
      this.moveSelection(-1);
      return;
    }
    if (this.matchesAction(keyData, "tui.select.down", "\u001b[B")) {
      this.moveSelection(1);
      return;
    }
    if (
      this.matchesAction(keyData, "tui.select.confirm", "\n") ||
      keyData === "\r"
    ) {
      if (this.filteredOptions.length > 0) {
        this.onSelect(this.filteredOptions[this.selectedIndex]);
      }
      return;
    }
    if (this.matchesAction(keyData, "tui.select.cancel", "\u001b")) {
      this.onCancel();
      return;
    }
    this.searchInput.handleInput(keyData);
    this.selectedIndex = 0;
    this.tui.requestRender();
  }

  private matchesAction(
    keyData: string,
    action: keyof Keybindings,
    fallback: string
  ) {
    return this.keybindings.matches(keyData, action) || keyData === fallback;
  }

  private moveSelection(direction: -1 | 1) {
    if (this.filteredOptions.length > 0) {
      const lastIndex = this.filteredOptions.length - 1;
      const nextIndex = this.selectedIndex + direction;
      if (nextIndex < 0) {
        this.selectedIndex = lastIndex;
      } else if (nextIndex > lastIndex) {
        this.selectedIndex = 0;
      } else {
        this.selectedIndex = nextIndex;
      }
    }
    this.tui.requestRender();
  }
}
