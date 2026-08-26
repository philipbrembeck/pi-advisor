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
  currentOption?: string;
  keybindings: KeybindingsManager;
  onCancel: () => void;
  onSelect: (value: string) => void;
  theme: Theme;
  title: string;
  tui: RenderRequester;
}
const stepNumericPreset = (
  current: number,
  presets: number[],
  direction: number
) => {
  const values = presets.includes(current)
    ? presets
    : [...presets, current].sort((a, b) => a - b);
  const index = values.indexOf(current);
  return values[Math.max(0, Math.min(values.length - 1, index + direction))];
};

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

export interface ContextPreset {
  description: string;
  label: string;
  value: number;
}

export interface AdvisorSettings {
  alwaysOn?: boolean;
  autoLoopGate?: boolean;
  blockOnBlocked?: boolean;
  collapseResponses: boolean;
  completionGate: boolean;
  contextMaxChars: number;
  customRule?: string;
  effort?: string;
  failureGate: boolean;
  failureMode?: "block-session" | "block-tool" | "warn-and-continue";
  gitContext?: "off" | "summary" | "full";
  gitContextMaxChars?: number;
  herdrIntegration?: boolean;
  loopThreshold?: number;
  maxCallsPerSession?: number;
  outcomeLogging?: boolean;
  planGate: boolean;
  redactSecrets?: boolean;
  scoutEnabled?: boolean;
  sessionSummary?: boolean;
  simpleMode?: boolean;
  toolPolicies?: Record<string, "full" | "summary" | "exclude">;
  toolResultMaxBytes?: number;
  toolResultMaxLines?: number;
  trackedFileContent?: boolean;
  untrackedContent?: boolean;
}

type AdvisorSettingsRow =
  | "simpleMode"
  | "alwaysOn"
  | "context"
  | "effort"
  | "scoutEnabled"
  | "planGate"
  | "failureGate"
  | "completionGate"
  | "collapseResponses"
  | "customRule"
  | "blockOnBlocked"
  | "autoLoopGate"
  | "loopThreshold"
  | "maxCallsPerSession"
  | "sessionSummary"
  | "failureMode"
  | "herdrIntegration"
  | "toolResultMaxLines"
  | "toolResultMaxBytes"
  | "redactSecrets"
  | "gitContext"
  | "gitContextMaxChars"
  | "toolPolicies"
  | "outcomeLogging"
  | "trackedFileContent"
  | "untrackedContent"
  | "save";

const ADVANCED_ROWS: AdvisorSettingsRow[] = [
  "context",
  "effort",
  "scoutEnabled",
  "planGate",
  "failureGate",
  "completionGate",
  "collapseResponses",
  "customRule",
  "blockOnBlocked",
  "autoLoopGate",
  "loopThreshold",
  "maxCallsPerSession",
  "sessionSummary",
  "failureMode",
  "herdrIntegration",
  "toolResultMaxLines",
  "toolResultMaxBytes",
  "redactSecrets",
  "gitContext",
  "gitContextMaxChars",
  "toolPolicies",
  "trackedFileContent",
  "untrackedContent",
  "outcomeLogging",
];

const SIMPLE_MODE_GRADIENT_INTERVAL_MS = 100;
// #763FCD and nearby lighter/darker purple steps; white is the moving shine.
const SIMPLE_MODE_GRADIENT_COLORS = [
  [125, 79, 205],
  [143, 96, 218],
  [160, 114, 230],
  [178, 135, 238],
  [195, 157, 245],
  [168, 120, 230],
  [143, 89, 215],
] as const;

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
  private simpleModeGradientStartedAt: number | undefined;
  private simpleModeGradientTimer: ReturnType<typeof setInterval> | undefined;
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
    // Retain every advanced value even when Simple mode hides its controls.
    this.settings = { ...options.initial };
    const configuredContext = this.settings.contextMaxChars;
    const presets = options.presets.some(
      (preset) => preset.value === configuredContext
    )
      ? [...options.presets]
      : [
          ...options.presets,
          {
            description: "Custom configured value",
            label: String(configuredContext),
            value: configuredContext,
          },
        ].sort((a, b) => a.value - b.value);
    this.options = { ...options, presets };
    this.contextIndex = presets.findIndex(
      (preset) => preset.value === configuredContext
    );
    this.effortIndex = Math.max(
      0,
      options.effortLevels.indexOf(
        this.settings.effort || "Default (Model Default)"
      )
    );
    if (this.settings.simpleMode) {
      this.startSimpleModeGradient();
    }
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

  /** Called by TUI teardown when it supports component disposal. */
  dispose(): void {
    this.stopSimpleModeGradient();
  }

  private visibleRows(): AdvisorSettingsRow[] {
    return this.settings.simpleMode
      ? ["context", "simpleMode", "alwaysOn", "save"]
      : [
          "context",
          "simpleMode",
          "alwaysOn",
          ...ADVANCED_ROWS.slice(1),
          "save",
        ];
  }

  private selectedRowId(): AdvisorSettingsRow {
    return this.visibleRows()[this.selectedRow] ?? "simpleMode";
  }

  private focusRow(rowId: AdvisorSettingsRow): void {
    this.selectedRow = Math.max(0, this.visibleRows().indexOf(rowId));
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

  private row(label: string, value: string, rowId: AdvisorSettingsRow): string {
    const { theme } = this.options;
    const selected = rowId === this.selectedRowId();
    const prefix = selected ? theme.fg("accent", "›") : " ";
    const text = `${prefix} ${label.padEnd(28)} ${value}`;
    if (
      rowId === "simpleMode" &&
      this.settings.simpleMode &&
      this.simpleModeGradientStartedAt !== undefined
    ) {
      return `${prefix} ${this.rainbowGradient(label)}${" ".repeat(Math.max(0, 28 - label.length))} ${value}`;
    }
    return selected
      ? theme.fg("accent", theme.bold(text))
      : theme.fg("text", text);
  }

  private rainbowGradient(text: string): string {
    const frame = Math.floor(
      (Date.now() - (this.simpleModeGradientStartedAt ?? 0)) /
        SIMPLE_MODE_GRADIENT_INTERVAL_MS
    );
    const shinePosition = frame % (text.length * 2);
    return [...text]
      .map((character, index) => {
        const [baseRed, baseGreen, baseBlue] =
          SIMPLE_MODE_GRADIENT_COLORS[
            index % SIMPLE_MODE_GRADIENT_COLORS.length
          ];
        const distance = Math.abs(index - shinePosition);
        let brightness = 0;
        if (distance === 0) {
          brightness = 0.7;
        } else if (distance === 1) {
          brightness = 0.35;
        }
        const red = Math.round(baseRed + (255 - baseRed) * brightness);
        const green = Math.round(baseGreen + (255 - baseGreen) * brightness);
        const blue = Math.round(baseBlue + (255 - baseBlue) * brightness);
        return `\x1b[38;2;${red};${green};${blue}m${character}`;
      })
      .join("")
      .concat("\x1b[0m");
  }

  private startSimpleModeGradient(): void {
    this.stopSimpleModeGradient();
    this.simpleModeGradientStartedAt = Date.now();
    this.simpleModeGradientTimer = setInterval(() => {
      this.options.tui.requestRender();
    }, SIMPLE_MODE_GRADIENT_INTERVAL_MS);
    this.simpleModeGradientTimer.unref?.();
  }

  private stopSimpleModeGradient(): void {
    if (this.simpleModeGradientTimer) {
      clearInterval(this.simpleModeGradientTimer);
      this.simpleModeGradientTimer = undefined;
    }
    this.simpleModeGradientStartedAt = undefined;
  }

  private save(): void {
    this.stopSimpleModeGradient();
    this.options.onSave({
      ...this.settings,
      contextMaxChars: this.currentContext().value,
      effort: this.currentEffort(),
    });
  }

  private cancel(): void {
    this.stopSimpleModeGradient();
    this.options.onCancel();
  }

  /** Disclosure and output-limit rows, split out to keep each builder simple. */
  private disclosureRows(): string[] {
    const onOff = (value: boolean) => (value ? "On" : "Off");
    return [
      this.row(
        "Tool result lines",
        String(this.settings.toolResultMaxLines ?? 2000),
        "toolResultMaxLines"
      ),
      this.row(
        "Tool result bytes",
        String(this.settings.toolResultMaxBytes ?? 50 * 1024),
        "toolResultMaxBytes"
      ),
      this.row(
        "Redact common secrets",
        onOff(this.settings.redactSecrets ?? false),
        "redactSecrets"
      ),
      this.row(
        "Repository context",
        this.settings.gitContext ?? "summary",
        "gitContext"
      ),
      this.row(
        "Repository context chars",
        String(this.settings.gitContextMaxChars ?? 20_000),
        "gitContextMaxChars"
      ),
      this.row(
        "Tool disclosure policies",
        Object.keys(this.settings.toolPolicies ?? {}).length
          ? "Exact names configured"
          : "All tools: full",
        "toolPolicies"
      ),
      this.row(
        "Tracked file content",
        onOff(this.settings.trackedFileContent ?? false),
        "trackedFileContent"
      ),
      this.row(
        "Untracked file content",
        onOff(this.settings.untrackedContent ?? false),
        "untrackedContent"
      ),
      this.row(
        "Outcome logging (global)",
        onOff(this.settings.outcomeLogging ?? false),
        "outcomeLogging"
      ),
    ];
  }

  private advancedRows(width: number): string[] {
    const onOff = (value: boolean) => (value ? "On" : "Off");
    const rows = [
      this.row("Advisor reasoning", this.currentEffort(), "effort"),
      this.row(
        "Experimental Advisor Scout",
        onOff(this.settings.scoutEnabled ?? false),
        "scoutEnabled"
      ),
      this.row("Plan gate", onOff(this.settings.planGate), "planGate"),
      this.row("Failure gate", onOff(this.settings.failureGate), "failureGate"),
      this.row(
        "Completion gate",
        onOff(this.settings.completionGate),
        "completionGate"
      ),
      this.row(
        "Collapse long responses",
        onOff(this.settings.collapseResponses),
        "collapseResponses"
      ),
      this.row(
        "Custom invocation",
        this.settings.customRule || "None",
        "customRule"
      ),
      this.row(
        "Block on critical advice",
        onOff(this.settings.blockOnBlocked ?? true),
        "blockOnBlocked"
      ),
      this.row(
        "Automatic loop gate",
        onOff(this.settings.autoLoopGate ?? true),
        "autoLoopGate"
      ),
      this.row(
        "Loop threshold",
        `After ${this.settings.loopThreshold ?? 3} repeats`,
        "loopThreshold"
      ),
      this.row(
        "Max Advisor calls/session",
        this.settings.maxCallsPerSession === undefined
          ? "∞"
          : String(this.settings.maxCallsPerSession),
        "maxCallsPerSession"
      ),
      this.row(
        "Session Advisor Summary",
        onOff(this.settings.sessionSummary ?? false),
        "sessionSummary"
      ),
      this.row(
        "Gate failure mode",
        this.settings.failureMode ?? "block-session",
        "failureMode"
      ),
      this.row(
        "Herdr integration",
        onOff(this.settings.herdrIntegration ?? true),
        "herdrIntegration"
      ),
      ...this.disclosureRows(),
    ];
    if (this.editingCustom) {
      rows.push(
        `    ${this.customInput.render(Math.max(10, width - 6))[0] || ""}`
      );
    }
    if (this.editingPolicies) {
      rows.push(
        `    ${this.policiesInput.render(Math.max(10, width - 6))[0] || ""}`
      );
      if (this.policiesError) {
        rows.push(`    ${this.options.theme.fg("error", this.policiesError)}`);
      }
    }
    rows.push(this.row("Save changes", "", "save"));
    return rows;
  }

  render(width: number): string[] {
    const { theme, presets } = this.options;
    const simpleMode = this.settings.simpleMode ?? false;
    const modeRows = [
      this.row("Simple mode", simpleMode ? "On" : "Off", "simpleMode"),
      this.row("Always on", this.settings.alwaysOn ? "On" : "Off", "alwaysOn"),
    ];
    const lines = [theme.fg("accent", theme.bold("  Advisor settings")), ""];
    if (simpleMode) {
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
      lines.push(
        `  ${this.row("Context window", this.currentContext().label, "context")}`
      );
      lines.push(`  ${theme.fg("muted", "Recent history")}`);
      lines.push(`  ${theme.fg("muted", track.join(""))}`);
      lines.push(`  ${theme.fg("text", labels.join(""))}`);
      lines.push("");
      lines.push(...modeRows.map((line) => `  ${line}`));
      lines.push(`  ${this.row("Save changes", "", "save")}`);
      lines.push("");
      lines.push(
        `  ${theme.fg("muted", "↑/↓ select · ←/→ adjust · Enter saves · Esc cancels")}`
      );
      return lines.map((line) => truncateToWidth(line, width));
    }

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
    lines.push(
      `  ${this.row("Context window", this.currentContext().label, "context")}`
    );
    lines.push(`  ${theme.fg("muted", heading)}`);
    lines.push(`  ${theme.fg("muted", track.join(""))}`);
    lines.push(`  ${theme.fg("text", labels.join(""))}`);
    lines.push("");
    lines.push(
      ...[...modeRows, ...this.advancedRows(width)].map((line) => `  ${line}`)
    );
    lines.push("");
    lines.push(
      `  ${theme.fg("muted", "↑/↓ select · ←/→ adjust · Enter edits or saves · Esc cancels")}`
    );
    return lines.map((line) => truncateToWidth(line, width));
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
      this.selectedRow = Math.min(
        this.visibleRows().length - 1,
        this.selectedRow + 1
      );
    } else if (matchesKey(keyData, Key.left)) {
      this.adjust(-1);
    } else if (matchesKey(keyData, Key.right)) {
      this.adjust(1);
    } else if (matchesKey(keyData, Key.enter)) {
      const row = this.selectedRowId();
      if (row === "customRule") {
        this.editingCustom = true;
        this.customInput.setValue(this.settings.customRule || "");
        this.customInput.focused = this.focused;
        tui.requestRender();
        return;
      }
      if (row === "toolPolicies") {
        this.editingPolicies = true;
        this.policiesError = undefined;
        this.policiesInput.setValue(
          JSON.stringify(this.settings.toolPolicies ?? {})
        );
        this.policiesInput.focused = this.focused;
        tui.requestRender();
        return;
      }
      if (row === "save") {
        this.save();
        return;
      }
      this.adjust(1);
    } else if (matchesKey(keyData, Key.escape)) {
      this.cancel();
      return;
    } else {
      return;
    }
    tui.requestRender();
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one keyboard dispatcher maps each settings row to its bounded adjustment.
  private adjust(direction: number): void {
    switch (this.selectedRowId()) {
      case "simpleMode":
        this.settings.simpleMode = !(this.settings.simpleMode ?? false);
        if (this.settings.simpleMode) {
          this.startSimpleModeGradient();
        } else {
          this.stopSimpleModeGradient();
        }
        // The visible row set changes with the mode, so keep the cursor on the
        // row the user is actually operating rather than on its old index.
        this.focusRow("simpleMode");
        break;
      case "alwaysOn":
        this.settings.alwaysOn = !(this.settings.alwaysOn ?? false);
        break;
      case "context":
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
      case "effort":
        this.effortIndex = Math.max(
          0,
          Math.min(
            this.options.effortLevels.length - 1,
            this.effortIndex + direction
          )
        );
        this.settings.effort = this.options.effortLevels[this.effortIndex];
        break;
      case "scoutEnabled":
        this.settings.scoutEnabled = !(this.settings.scoutEnabled ?? false);
        break;
      case "planGate":
        this.settings.planGate = !this.settings.planGate;
        break;
      case "failureGate":
        this.settings.failureGate = !this.settings.failureGate;
        break;
      case "completionGate":
        this.settings.completionGate = !this.settings.completionGate;
        break;
      case "collapseResponses":
        this.settings.collapseResponses = !this.settings.collapseResponses;
        break;
      case "blockOnBlocked":
        this.settings.blockOnBlocked = !(this.settings.blockOnBlocked ?? true);
        break;
      case "autoLoopGate":
        this.settings.autoLoopGate = !(this.settings.autoLoopGate ?? true);
        break;
      case "loopThreshold":
        this.settings.loopThreshold = Math.max(
          2,
          (this.settings.loopThreshold ?? 3) + direction
        );
        break;
      case "maxCallsPerSession": {
        const current = this.settings.maxCallsPerSession;
        const numeric = [0, 1, 2, 3, 5, 10, 25, 50];
        const sorted =
          current === undefined || numeric.includes(current)
            ? numeric
            : [...numeric, current].sort((a, b) => a - b);
        const values: (number | undefined)[] = [undefined, ...sorted];
        const index = values.indexOf(current);
        this.settings.maxCallsPerSession =
          values[Math.max(0, Math.min(values.length - 1, index + direction))];
        break;
      }
      case "sessionSummary":
        this.settings.sessionSummary = !(this.settings.sessionSummary ?? false);
        break;
      case "failureMode": {
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
      case "herdrIntegration":
        this.settings.herdrIntegration = !(
          this.settings.herdrIntegration ?? true
        );
        break;
      case "redactSecrets":
        this.settings.redactSecrets = !(this.settings.redactSecrets ?? false);
        break;
      case "trackedFileContent":
        this.settings.trackedFileContent = !(
          this.settings.trackedFileContent ?? false
        );
        break;
      case "untrackedContent":
        this.settings.untrackedContent = !(
          this.settings.untrackedContent ?? false
        );
        break;
      case "outcomeLogging":
        this.settings.outcomeLogging = !(this.settings.outcomeLogging ?? false);
        break;
      case "gitContext": {
        const levels: AdvisorSettings["gitContext"][] = [
          "off",
          "summary",
          "full",
        ];
        const index = Math.max(
          0,
          levels.indexOf(this.settings.gitContext ?? "summary")
        );
        this.settings.gitContext =
          levels[Math.max(0, Math.min(levels.length - 1, index + direction))];
        break;
      }
      case "gitContextMaxChars": {
        this.settings.gitContextMaxChars = stepNumericPreset(
          this.settings.gitContextMaxChars ?? 20_000,
          [0, 5000, 10_000, 20_000, 50_000, 100_000],
          direction
        );
        break;
      }
      case "toolResultMaxLines": {
        this.settings.toolResultMaxLines = stepNumericPreset(
          this.settings.toolResultMaxLines ?? 2000,
          [0, 500, 1000, 2000, 5000, 10_000],
          direction
        );
        break;
      }
      case "toolResultMaxBytes": {
        this.settings.toolResultMaxBytes = stepNumericPreset(
          this.settings.toolResultMaxBytes ?? 50 * 1024,
          [0, 10 * 1024, 50 * 1024, 100 * 1024, 500 * 1024],
          direction
        );
        break;
      }
      default:
        break;
    }
  }
}
