import { Input, fuzzyFilter, type Component, type Focusable } from "@earendil-works/pi-tui";
import { Box, Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

export class SearchableModelSelector implements Component, Focusable {
  private tui: any;
  private searchInput: Input;
  private allOptions: string[];
  private filteredOptions: string[];
  private selectedIndex = 0;
  private title: string;
  private onSelect: (value: string) => void;
  private onCancel: () => void;
  private theme: Theme;
  private keybindings: any;
  private _focused = false;

  public get focused(): boolean { return this._focused; }
  public set focused(val: boolean) {
    this._focused = val;
    this.searchInput.focused = val;
  }

  constructor(options: {
    tui: any;
    title: string;
    allOptions: string[];
    theme: Theme;
    keybindings: any;
    onSelect: (value: string) => void;
    onCancel: () => void;
  }) {
    this.tui = options.tui;
    this.title = options.title;
    this.allOptions = options.allOptions;
    this.theme = options.theme;
    this.keybindings = options.keybindings;
    this.onSelect = options.onSelect;
    this.onCancel = options.onCancel;
    this.searchInput = new Input();
    this.filteredOptions = this.allOptions;
  }

  invalidate(): void { this.searchInput.invalidate(); }

  render(width: number): string[] {
    const lines: string[] = ["═".repeat(width)];
    lines.push(`  ${this.theme.fg("accent", this.theme.bold(this.title))}`);
    const inputLines = this.searchInput.render(width - 12);
    lines.push(`  ${this.theme.fg("accent", "Search: ")}${inputLines[0] || ""}`);
    lines.push("");

    const query = this.searchInput.getValue().trim();
    this.filteredOptions = query ? fuzzyFilter(this.allOptions, query, (item) => item) : this.allOptions;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredOptions.length - 1));

    const maxVisible = 10;
    const total = this.filteredOptions.length;
    if (total === 0) {
      lines.push("  " + this.theme.fg("muted", "No matching models found."));
    } else {
      const startIndex = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), total - maxVisible));
      const endIndex = Math.min(startIndex + maxVisible, total);
      for (let i = startIndex; i < endIndex; i++) {
        const item = this.filteredOptions[i];
        if (i === this.selectedIndex) lines.push(`  ${this.theme.fg("accent", "→ ")}${this.theme.fg("accent", item)}`);
        else lines.push(`    ${this.theme.fg("text", item)}`);
      }
      if (total > maxVisible) lines.push("  " + this.theme.fg("muted", `  (${this.selectedIndex + 1}/${total})`));
    }
    lines.push("");
    lines.push(`  ${this.theme.fg("muted", "Type to search · ↑↓: navigate · Enter: select · Esc: cancel")}`);
    lines.push("═".repeat(width));
    return lines;
  }

  handleInput(keyData: string): void {
    const kb = this.keybindings;
    if (kb.matches(keyData, "tui.select.up") || keyData === "\u001b[A") {
      if (this.filteredOptions.length > 0) this.selectedIndex = this.selectedIndex === 0 ? this.filteredOptions.length - 1 : this.selectedIndex - 1;
      this.tui.requestRender();
    } else if (kb.matches(keyData, "tui.select.down") || keyData === "\u001b[B") {
      if (this.filteredOptions.length > 0) this.selectedIndex = this.selectedIndex === this.filteredOptions.length - 1 ? 0 : this.selectedIndex + 1;
      this.tui.requestRender();
    } else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n" || keyData === "\r") {
      if (this.filteredOptions.length > 0) this.onSelect(this.filteredOptions[this.selectedIndex]);
    } else if (kb.matches(keyData, "tui.select.cancel") || keyData === "\u001b") {
      this.onCancel();
    } else {
      this.searchInput.handleInput(keyData);
      this.selectedIndex = 0;
      this.tui.requestRender();
    }
  }
}
