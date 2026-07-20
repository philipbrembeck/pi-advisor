import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Focusable,
  fuzzyFilter,
  Input,
  Key,
  type Keybindings,
  type KeybindingsManager,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { isValidAdvisorToolPolicies } from "./config.js";

interface RenderRequester {
  requestRender: () => void;
}
interface SearchableModelSelectorOptions {
  allOptions: string[];
  keybindings: KeybindingsManager;
  onCancel: () => void;
  onSelect: (value: string) => void;
  theme: Theme;
  title: string;
  tui: RenderRequester;
}
interface AdvisorSettingsSelectorOptions {
  effortLevels: string[];
  initial: AdvisorSettings;
  onCancel: () => void;
  onSave: (settings: AdvisorSettings) => void;
  presets: ContextPreset[];
  theme: Theme;
  tui: RenderRequester;
}

export class SearchableModelSelector implements Component, Focusable {
  private readonly tui: RenderRequester;
  private readonly searchInput: Input;
  private readonly allOptions: string[];
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
    this.allOptions = options.allOptions;
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
        if (i === this.selectedIndex) {
          lines.push(
            `  ${this.theme.fg("accent", "→ ")}${this.theme.fg("accent", item)}`
          );
        } else {
          lines.push(`    ${this.theme.fg("text", item)}`);
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

export interface ContextPreset {
  description: string;
  label: string;
  value: number;
}

export interface AdvisorSettings {
  autoLoopGate?: boolean;
  blockOnBlocked?: boolean;
  collapseResponses: boolean;
  completionGate: boolean;
  contextMaxChars: number;
  customRule?: string;
  effort?: string;
  failureGate: boolean;
  failureMode?: "block-session" | "block-tool" | "warn-and-continue";
  herdrIntegration?: boolean;
  loopThreshold?: number;
  maxCallsPerSession?: number;
  planGate: boolean;
  redactSecrets?: boolean;
  sessionSummary?: boolean;
  toolPolicies?: Record<string, "full" | "summary" | "exclude">;
  toolResultMaxBytes?: number;
  toolResultMaxLines?: number;
}

export class AdvisorSettingsSelector implements Component, Focusable {
  private selectedRow: number;
  private contextIndex: number;
  private effortIndex: number;
  private readonly settings: AdvisorSettings;
  private readonly customInput = new Input();
  private readonly policiesInput = new Input();
  private editingCustom: boolean;
  private editingPolicies: boolean;
  private policiesError: string | undefined;
  private _focused = false;
  private readonly options: AdvisorSettingsSelectorOptions;

  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.customInput.focused = value && this.editingCustom;
    this.policiesInput.focused = value && this.editingPolicies;
  }

  constructor(options: AdvisorSettingsSelectorOptions) {
    this.selectedRow = 0;
    this.editingCustom = false;
    this.editingPolicies = false;
    this.policiesError = undefined;
    this.options = options;
    this.settings = { ...options.initial };
    this.contextIndex = Math.max(
      0,
      options.presets.findIndex(
        (preset) => preset.value === this.settings.contextMaxChars
      )
    );
    this.effortIndex = Math.max(
      0,
      options.effortLevels.indexOf(
        this.settings.effort || "Default (Model Default)"
      )
    );
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
    this.policiesInput.onSubmit = (value) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value || "{}");
      } catch {
        this.policiesError = "Enter a valid JSON object.";
        this.options.tui.requestRender();
        return;
      }
      if (!isValidAdvisorToolPolicies(parsed)) {
        this.policiesError =
          "Use non-empty tool names with full, summary, or exclude values.";
        this.options.tui.requestRender();
        return;
      }
      this.settings.toolPolicies = parsed;
      this.policiesError = undefined;
      this.editingPolicies = false;
      this.policiesInput.focused = false;
      this.options.tui.requestRender();
    };
    this.policiesInput.onEscape = () => {
      this.editingPolicies = false;
      this.policiesInput.focused = false;
      this.options.tui.requestRender();
    };
  }

  invalidate(): void {
    this.options.tui.requestRender();
  }

  private currentContext(): ContextPreset {
    const preset = this.options.presets.find(
      (item) => item.value === this.settings.contextMaxChars
    );
    return (
      preset ?? {
        description: "Current custom context limit",
        label: String(this.settings.contextMaxChars),
        value: this.settings.contextMaxChars,
      }
    );
  }
  private currentEffort() {
    return this.settings.effort || "Default (Model Default)";
  }
  private row(label: string, value: string, index: number) {
    const { theme } = this.options;
    const prefix = index === this.selectedRow ? theme.fg("accent", "›") : " ";
    const text = `${prefix} ${label.padEnd(28)} ${value}`;
    return index === this.selectedRow
      ? theme.fg("accent", theme.bold(text))
      : theme.fg("text", text);
  }

  private policyInputRows(width: number): string[] {
    if (!this.editingPolicies) {
      return [];
    }
    const rows = [
      `    ${this.policiesInput.render(Math.max(10, width - 6))[0] || ""}`,
    ];
    if (this.policiesError) {
      rows.push(`    ${this.options.theme.fg("error", this.policiesError)}`);
    }
    return rows;
  }

  render(width: number): string[] {
    const { theme, presets } = this.options;
    const trackWidth = Math.max(24, Math.min(60, width - 4));
    const positions = presets.map((_, index) =>
      Math.round((index * (trackWidth - 1)) / Math.max(1, presets.length - 1))
    );
    const track = Array.from({ length: trackWidth }, () => "─");
    track[positions[this.contextIndex]] = "▲";
    const labels = Array.from({ length: trackWidth }, () => " ");
    for (let index = 0; index < presets.length; index += 1) {
      const { label } = presets[index];
      const start = Math.max(
        0,
        Math.min(
          trackWidth - label.length,
          positions[index] - Math.floor(label.length / 2)
        )
      );
      for (let char = 0; char < label.length; char += 1) {
        labels[start + char] = label[char];
      }
    }
    const heading = `Recent history${" ".repeat(Math.max(1, trackWidth - "Recent history".length - "Full branch".length))}Full branch`;
    const onOff = (value: boolean) => (value ? "On" : "Off");
    const rows = [
      this.row("Context window", this.currentContext().label, 0),
      this.row("Advisor reasoning", this.currentEffort(), 1),
      this.row("Plan gate", onOff(this.settings.planGate), 2),
      this.row("Failure gate", onOff(this.settings.failureGate), 3),
      this.row("Completion gate", onOff(this.settings.completionGate), 4),
      this.row(
        "Collapse long responses",
        onOff(this.settings.collapseResponses),
        5
      ),
      this.row("Custom invocation", this.settings.customRule || "None", 6),
      this.row(
        "Block on critical advice",
        onOff(this.settings.blockOnBlocked ?? true),
        7
      ),
      this.row(
        "Automatic loop gate",
        onOff(this.settings.autoLoopGate ?? true),
        8
      ),
      this.row(
        "Loop threshold",
        `After ${this.settings.loopThreshold ?? 3} repeats`,
        9
      ),
      this.row(
        "Max Advisor calls/session",
        this.settings.maxCallsPerSession === undefined
          ? "∞"
          : String(this.settings.maxCallsPerSession),
        10
      ),
      this.row(
        "Session Advisor Summary",
        onOff(this.settings.sessionSummary ?? true),
        11
      ),
      this.row(
        "Gate failure mode",
        this.settings.failureMode ?? "block-session",
        12
      ),
      this.row(
        "Herdr integration",
        onOff(this.settings.herdrIntegration ?? true),
        13
      ),
      this.row(
        "Tool result lines",
        String(this.settings.toolResultMaxLines ?? 2000),
        14
      ),
      this.row(
        "Tool result bytes",
        String(this.settings.toolResultMaxBytes ?? 50 * 1024),
        15
      ),
      this.row(
        "Redact common secrets",
        onOff(this.settings.redactSecrets ?? false),
        16
      ),
      this.row(
        "Tool disclosure policies",
        Object.keys(this.settings.toolPolicies ?? {}).length
          ? "Exact names configured"
          : "All tools: full",
        17
      ),
    ];
    if (this.editingCustom) {
      rows.push(
        `    ${this.customInput.render(Math.max(10, width - 6))[0] || ""}`
      );
    }
    rows.push(...this.policyInputRows(width));
    rows.push(this.row("Save changes", "", 18));
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
    if (this.editingPolicies) {
      this.policiesInput.handleInput(keyData);
      return;
    }
    if (matchesKey(keyData, Key.up)) {
      this.selectedRow = Math.max(0, this.selectedRow - 1);
    } else if (matchesKey(keyData, Key.down)) {
      this.selectedRow = Math.min(18, this.selectedRow + 1);
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
      if (this.selectedRow === 17) {
        this.editingPolicies = true;
        this.policiesError = undefined;
        this.policiesInput.setValue(
          JSON.stringify(this.settings.toolPolicies ?? {})
        );
        this.policiesInput.focused = this.focused;
        tui.requestRender();
        return;
      }
      if (this.selectedRow === 18) {
        this.options.onSave({
          ...this.settings,
          contextMaxChars: this.currentContext().value,
          effort: this.currentEffort(),
        });
        return;
      }
      this.adjust(1);
    } else if (matchesKey(keyData, Key.escape)) {
      this.options.onCancel();
      return;
    } else {
      return;
    }
    tui.requestRender();
  }

  private adjust(direction: number) {
    switch (this.selectedRow) {
      case 0:
        this.contextIndex = Math.max(
          0,
          Math.min(
            this.options.presets.length - 1,
            this.contextIndex + direction
          )
        );
        this.settings.contextMaxChars =
          this.options.presets[this.contextIndex].value;
        break;
      case 1:
        this.effortIndex = Math.max(
          0,
          Math.min(
            this.options.effortLevels.length - 1,
            this.effortIndex + direction
          )
        );
        this.settings.effort = this.options.effortLevels[this.effortIndex];
        break;
      case 2:
        this.settings.planGate = !this.settings.planGate;
        break;
      case 3:
        this.settings.failureGate = !this.settings.failureGate;
        break;
      case 4:
        this.settings.completionGate = !this.settings.completionGate;
        break;
      case 5:
        this.settings.collapseResponses = !this.settings.collapseResponses;
        break;
      case 7:
        this.settings.blockOnBlocked = !(this.settings.blockOnBlocked ?? true);
        break;
      case 8:
        this.settings.autoLoopGate = !(this.settings.autoLoopGate ?? true);
        break;
      case 9:
        this.settings.loopThreshold = Math.max(
          2,
          (this.settings.loopThreshold ?? 3) + direction
        );
        break;
      case 10: {
        const values = [undefined, 0, 1, 2, 3, 5, 10, 25, 50];
        const index = Math.max(
          0,
          values.indexOf(this.settings.maxCallsPerSession)
        );
        this.settings.maxCallsPerSession =
          values[Math.max(0, Math.min(values.length - 1, index + direction))];
        break;
      }
      case 11:
        this.settings.sessionSummary = !(this.settings.sessionSummary ?? true);
        break;
      case 12: {
        const modes: AdvisorSettings["failureMode"][] = [
          "block-session",
          "block-tool",
          "warn-and-continue",
        ];
        const index = Math.max(
          0,
          modes.indexOf(this.settings.failureMode ?? "block-session")
        );
        this.settings.failureMode =
          modes[Math.max(0, Math.min(modes.length - 1, index + direction))];
        break;
      }
      case 13:
        this.settings.herdrIntegration = !(
          this.settings.herdrIntegration ?? true
        );
        break;
      case 16:
        this.settings.redactSecrets = !(this.settings.redactSecrets ?? false);
        break;
      case 14: {
        const values = [0, 500, 1000, 2000, 5000, 10_000];
        const index = Math.max(
          0,
          values.indexOf(this.settings.toolResultMaxLines ?? 2000)
        );
        this.settings.toolResultMaxLines =
          values[Math.max(0, Math.min(values.length - 1, index + direction))];
        break;
      }
      case 15: {
        const values = [0, 10 * 1024, 50 * 1024, 100 * 1024, 500 * 1024];
        const index = Math.max(
          0,
          values.indexOf(this.settings.toolResultMaxBytes ?? 50 * 1024)
        );
        this.settings.toolResultMaxBytes =
          values[Math.max(0, Math.min(values.length - 1, index + direction))];
        break;
      }
      default:
        break;
    }
  }
}
