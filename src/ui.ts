import { Input, Key, matchesKey, fuzzyFilter, truncateToWidth, type Component, type Focusable } from "@earendil-works/pi-tui";
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

export type ContextPreset = { label: string; value: number; description: string };

export type AdvisorSettings = {
  contextMaxChars: number;
  effort?: string;
  planGate: boolean;
  failureGate: boolean;
  completionGate: boolean;
  collapseResponses: boolean;
  customRule?: string;
};

export class AdvisorSettingsSelector implements Component, Focusable {
  private selectedRow = 0;
  private contextIndex: number;
  private effortIndex: number;
  private settings: AdvisorSettings;
  private customInput = new Input();
  private editingCustom = false;
  private _focused = false;

  public get focused() { return this._focused; }
  public set focused(value: boolean) {
    this._focused = value;
    this.customInput.focused = value && this.editingCustom;
  }

  constructor(private options: {
    tui: any;
    theme: Theme;
    presets: ContextPreset[];
    effortLevels: string[];
    initial: AdvisorSettings;
    onSave: (settings: AdvisorSettings) => void;
    onCancel: () => void;
  }) {
    this.settings = { ...options.initial };
    this.contextIndex = Math.max(0, options.presets.findIndex((preset) => preset.value === this.settings.contextMaxChars));
    this.effortIndex = Math.max(0, options.effortLevels.indexOf(this.settings.effort || "Default (Model Default)"));
    this.customInput.onSubmit = (value) => {
      this.settings.customRule = value.trim() || undefined;
      this.editingCustom = false;
      this.customInput.focused = false;
      this.options.tui.requestRender();
    };
    this.customInput.onEscape = () => {
      this.editingCustom = false;
      this.customInput.focused = false;
      this.options.tui.requestRender();
    };
  }

  invalidate(): void { this.options.tui.requestRender(); }

  private currentContext() { return this.options.presets[this.contextIndex]; }
  private row(label: string, value: string, index: number) {
    const { theme } = this.options;
    const prefix = index === this.selectedRow ? theme.fg("accent", "›") : " ";
    const text = `${prefix} ${label.padEnd(28)} ${value}`;
    return index === this.selectedRow ? theme.fg("accent", theme.bold(text)) : theme.fg("text", text);
  }

  render(width: number): string[] {
    const { theme, presets } = this.options;
    const trackWidth = Math.max(24, Math.min(60, width - 4));
    const positions = presets.map((_, index) => Math.round(index * (trackWidth - 1) / (presets.length - 1)));
    const track = Array.from({ length: trackWidth }, () => "─");
    track[positions[this.contextIndex]] = "▲";
    const labels = Array.from({ length: trackWidth }, () => " ");
    for (let index = 0; index < presets.length; index++) {
      const label = presets[index].label;
      const start = Math.max(0, Math.min(trackWidth - label.length, positions[index] - Math.floor(label.length / 2)));
      for (let char = 0; char < label.length; char++) labels[start + char] = label[char];
    }
    const heading = `Recent history${" ".repeat(Math.max(1, trackWidth - "Recent history".length - "Full branch".length))}Full branch`;
    const onOff = (value: boolean) => value ? "On" : "Off";
    const rows = [
      this.row("Context window", this.currentContext().label, 0),
      this.row("Advisor reasoning", this.options.effortLevels[this.effortIndex], 1),
      this.row("Plan gate", onOff(this.settings.planGate), 2),
      this.row("Failure gate", onOff(this.settings.failureGate), 3),
      this.row("Completion gate", onOff(this.settings.completionGate), 4),
      this.row("Collapse long responses", onOff(this.settings.collapseResponses), 5),
      this.row("Custom invocation", this.settings.customRule || "None", 6),
    ];
    if (this.editingCustom) rows.push(`    ${this.customInput.render(Math.max(10, width - 6))[0] || ""}`);
    rows.push(this.row("Save changes", "", 7));
    return [
      theme.fg("accent", theme.bold("  Advisor settings")),
      "",
      `  ${theme.fg("muted", heading)}`,
      `  ${theme.fg("muted", track.join(""))}`,
      `  ${theme.fg("text", labels.join(""))}`,
      "",
      ...rows.map((line) => `  ${line}`),
      "",
      `  ${theme.fg("muted", "↑/↓ select · ←/→ adjust · Enter edits or saves · Esc cancels")}`,
    ].map((line) => truncateToWidth(line, width));
  }

  handleInput(keyData: string): void {
    const { tui } = this.options;
    if (this.editingCustom) {
      this.customInput.handleInput(keyData);
      return;
    }
    if (matchesKey(keyData, Key.up)) {
      this.selectedRow = Math.max(0, this.selectedRow - 1);
    } else if (matchesKey(keyData, Key.down)) {
      this.selectedRow = Math.min(7, this.selectedRow + 1);
    } else if (matchesKey(keyData, Key.left)) {
      this.adjust(-1);
    } else if (matchesKey(keyData, Key.right)) {
      this.adjust(1);
    } else if (matchesKey(keyData, Key.enter)) {
      if (this.selectedRow === 6) {
        this.editingCustom = true;
        this.customInput.setValue(this.settings.customRule || "");
        this.customInput.focused = this.focused;
        tui.requestRender();
        return;
      }
      if (this.selectedRow === 7) return this.options.onSave({ ...this.settings, contextMaxChars: this.currentContext().value, effort: this.options.effortLevels[this.effortIndex] });
      this.adjust(1);
    } else if (matchesKey(keyData, Key.escape)) {
      return this.options.onCancel();
    } else return;
    tui.requestRender();
  }

  private adjust(direction: number) {
    switch (this.selectedRow) {
      case 0: this.contextIndex = Math.max(0, Math.min(this.options.presets.length - 1, this.contextIndex + direction)); break;
      case 1: this.effortIndex = Math.max(0, Math.min(this.options.effortLevels.length - 1, this.effortIndex + direction)); break;
      case 2: this.settings.planGate = !this.settings.planGate; break;
      case 3: this.settings.failureGate = !this.settings.failureGate; break;
      case 4: this.settings.completionGate = !this.settings.completionGate; break;
      case 5: this.settings.collapseResponses = !this.settings.collapseResponses; break;
    }
  }
}
