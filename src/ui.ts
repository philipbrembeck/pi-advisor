import {
  getSettingsListTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Focusable,
  fuzzyFilter,
  Input,
  Key,
  type Keybindings,
  type KeybindingsManager,
  matchesKey,
  type SettingItem,
  SettingsList,
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
  showUsageDetails?: boolean;
  showUsageFooter?: boolean;
  simpleMode?: boolean;
  toolPolicies?: Record<string, "full" | "summary" | "exclude">;
  toolResultMaxBytes?: number;
  toolResultMaxLines?: number;
  trackedFileContent?: boolean;
  untrackedContent?: boolean;
}

type SettingValue = string | undefined;

interface AdvisorSettingsSelectorOptions {
  effortLevels: string[];
  initial: AdvisorSettings;
  onCancel: () => void;
  onChange?: (settings: AdvisorSettings) => void;
  /** @deprecated Use onChange; retained for extensions embedding this component. */
  onSave?: (settings: AdvisorSettings) => void;
  presets: ContextPreset[];
  theme: Theme;
  tui: RenderRequester;
}

interface TextSettingSubmenuOptions {
  description: string;
  initial: string;
  onCancel: (value?: string) => void;
  onSubmit: (value: string) => { error?: string; value?: string };
  theme: Theme;
  title: string;
  tui: RenderRequester;
}

/** Small inline editor used by SettingsList for the two free-form settings. */
class TextSettingSubmenu implements Component, Focusable {
  private readonly input = new Input();
  private readonly options: TextSettingSubmenuOptions;
  private _focused = true;
  private error: string | undefined;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  constructor(options: TextSettingSubmenuOptions) {
    this.options = options;
    this.input.setValue(options.initial);
    this.input.focused = true;
    this.input.onSubmit = (value) => {
      const result = options.onSubmit(value);
      if (result.error) {
        this.error = result.error;
        options.tui.requestRender();
        return;
      }
      this.error = undefined;
      options.onCancel(result.value);
    };
    this.input.onEscape = () => options.onCancel();
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    const { theme } = this.options;
    const input = this.input.render(Math.max(10, width - 4))[0] || "";
    const lines = [
      theme.fg("accent", theme.bold(`  ${this.options.title}`)),
      "",
      theme.fg("muted", `  ${this.options.description}`),
      "",
      `  ${input}`,
    ];
    if (this.error) {
      lines.push(theme.fg("error", `  ${this.error}`));
    }
    lines.push("", theme.fg("dim", "  Enter: apply · Esc: cancel"));
    return lines.map((line) => truncateToWidth(line, width));
  }

  handleInput(keyData: string): void {
    this.input.handleInput(keyData);
  }
}

const DEFAULT_EFFORT_LEVEL = "Default (Model Default)";
const TOGGLE_VALUES = ["On", "Off"];
const SIMPLE_MODE_GRADIENT_INTERVAL_MS = 100;
// Purple steps with a moving light highlight, retained from the original UI.
const SIMPLE_MODE_GRADIENT_COLORS = [
  [125, 79, 205],
  [143, 96, 218],
  [160, 114, 230],
  [178, 135, 238],
  [195, 157, 245],
  [168, 120, 230],
  [143, 89, 215],
] as const;
const BOOLEAN_SETTING_IDS = new Set([
  "scoutEnabled",
  "showUsageDetails",
  "showUsageFooter",
  "planGate",
  "failureGate",
  "completionGate",
  "collapseResponses",
  "blockOnBlocked",
  "autoLoopGate",
  "sessionSummary",
  "herdrIntegration",
  "redactSecrets",
  "trackedFileContent",
  "untrackedContent",
  "outcomeLogging",
]);

const withCurrentValue = (current: string, values: string[]) =>
  values.includes(current) ? values : [current, ...values];

const numericValues = (current: number, values: number[]) => {
  const all = values.includes(current) ? values : [...values, current];
  return all.sort((a, b) => a - b).map(String);
};

const settingValue = (value: boolean | undefined, defaultValue: boolean) =>
  (value ?? defaultValue) ? "On" : "Off";

export class AdvisorSettingsSelector implements Component, Focusable {
  private readonly options: AdvisorSettingsSelectorOptions;
  private readonly settings: AdvisorSettings;
  private readonly presets: ContextPreset[];
  private settingsList: SettingsList;
  private simpleModeGradientStartedAt: number | undefined;
  private simpleModeGradientTimer: ReturnType<typeof setInterval> | undefined;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    const submenu = this.settingsList as unknown as {
      submenuComponent?: Focusable;
    };
    if (submenu.submenuComponent) {
      submenu.submenuComponent.focused = value;
    }
  }

  constructor(options: AdvisorSettingsSelectorOptions) {
    this.options = options;
    this.settings = { ...options.initial };
    const configuredContext = this.settings.contextMaxChars;
    this.presets = options.presets.some(
      (preset) => preset.value === configuredContext
    )
      ? [...options.presets]
      : [
          ...options.presets,
          {
            description: "Current custom context limit",
            label: String(configuredContext),
            value: configuredContext,
          },
        ].sort((a, b) => a.value - b.value);
    if (this.settings.simpleMode) {
      this.startSimpleModeGradient();
    }
    this.settingsList = this.createSettingsList();
  }

  invalidate(): void {
    this.settingsList.invalidate();
  }

  dispose(): void {
    this.stopSimpleModeGradient();
  }

  render(width: number): string[] {
    const border = this.options.theme.fg(
      "border",
      "─".repeat(Math.max(1, width))
    );
    return [border, ...this.settingsList.render(width), border].map((line) =>
      truncateToWidth(line, width)
    );
  }

  handleInput(keyData: string): void {
    if (!this.changeWithArrow(keyData)) {
      this.settingsList.handleInput(keyData);
    }
    this.options.tui.requestRender();
  }

  private changeWithArrow(keyData: string): boolean {
    let direction = 0;
    if (matchesKey(keyData, Key.left) || keyData === "\u001b[D") {
      direction = -1;
    } else if (matchesKey(keyData, Key.right) || keyData === "\u001b[C") {
      direction = 1;
    }
    if (direction === 0) {
      return false;
    }
    // SettingsList has no public selection/value-adjustment API. Keep this
    // compatibility shim isolated to the native component's current fields.
    const list = this.settingsList as unknown as {
      filteredItems: SettingItem[];
      searchInput?: Input;
      selectedIndex: number;
      submenuComponent?: Component | null;
    };
    if (list.submenuComponent || list.searchInput?.getValue()) {
      return false;
    }
    const item = list.filteredItems[list.selectedIndex];
    if (!item?.values?.length) {
      return false;
    }
    const currentIndex = item.values.indexOf(item.currentValue);
    let nextIndex: number;
    if (currentIndex === -1) {
      nextIndex = direction > 0 ? 0 : item.values.length - 1;
    } else {
      nextIndex =
        (currentIndex + direction + item.values.length) % item.values.length;
    }
    const nextValue = item.values[nextIndex];
    if (nextValue === undefined) {
      return false;
    }
    item.currentValue = nextValue;
    this.change(item.id, nextValue);
    return true;
  }

  private createSettingsList(selectedId?: string): SettingsList {
    const listTheme = getSettingsListTheme();
    const defaultLabel = listTheme.label;
    listTheme.label = (text, selected) => {
      if (this.settings.simpleMode && text.startsWith("Simple mode")) {
        return `${this.rainbowGradient("Simple mode")}${text.slice("Simple mode".length)}`;
      }
      return defaultLabel(text, selected);
    };
    const items = this.items();
    const list = new SettingsList(
      items,
      10,
      listTheme,
      (id, value) => this.change(id, value),
      this.options.onCancel,
      { enableSearch: true }
    );
    if (selectedId) {
      const selectedIndex = items.findIndex((item) => item.id === selectedId);
      if (selectedIndex >= 0) {
        (list as unknown as { selectedIndex: number }).selectedIndex =
          selectedIndex;
      }
    }
    return list;
  }

  private items(): SettingItem[] {
    const items: SettingItem[] = [
      {
        currentValue: this.currentContextLabel(),
        description: this.contextDescription(),
        id: "context",
        label: "Context window",
        values: this.presets.map((preset) => preset.label),
      },
      {
        currentValue: settingValue(this.settings.simpleMode, false),
        description:
          "Keep the Advisor available on demand without automatic gates or blocks.",
        id: "simpleMode",
        label: "Simple mode",
        values: TOGGLE_VALUES,
      },
      {
        currentValue: settingValue(this.settings.alwaysOn, false),
        description:
          "Run the Advisor flow automatically for supported agent turns.",
        id: "alwaysOn",
        label: "Always on",
        values: TOGGLE_VALUES,
      },
    ];
    if (this.settings.simpleMode) {
      return items;
    }

    items.push(
      {
        currentValue: this.currentEffort(),
        description: "Reasoning level used for Advisor calls.",
        id: "effort",
        label: "Advisor reasoning",
        values: withCurrentValue(
          this.currentEffort(),
          this.options.effortLevels
        ),
      },
      this.toggle(
        "scoutEnabled",
        "Experimental Advisor Scout",
        "Enable the experimental Scout before Advisor calls.",
        this.settings.scoutEnabled,
        false
      ),
      this.toggle(
        "showUsageDetails",
        "Show usage and cost details",
        "Show token usage and cost details in Advisor responses.",
        this.settings.showUsageDetails,
        true
      ),
      this.toggle(
        "showUsageFooter",
        "Show usage in footer",
        "Show the current Advisor usage summary in the footer.",
        this.settings.showUsageFooter,
        false
      ),
      this.toggle(
        "planGate",
        "Plan gate",
        "Ask the Advisor to review implementation plans.",
        this.settings.planGate,
        true
      ),
      this.toggle(
        "failureGate",
        "Failure gate",
        "Ask the Advisor to review repeated failures.",
        this.settings.failureGate,
        true
      ),
      this.toggle(
        "completionGate",
        "Completion gate",
        "Ask the Advisor to review work before declaring success.",
        this.settings.completionGate,
        true
      ),
      this.toggle(
        "collapseResponses",
        "Collapse long responses",
        "Collapse long Advisor responses in the transcript.",
        this.settings.collapseResponses,
        false
      ),
      {
        currentValue: this.settings.customRule || "None",
        description: "Add a rule that triggers Advisor involvement.",
        id: "customRule",
        label: "Custom invocation",
        submenu: (_currentValue, done) =>
          new TextSettingSubmenu({
            description: "Enter a custom invocation rule.",
            initial: this.settings.customRule || "",
            onCancel: done,
            onSubmit: (value) => ({ value: value.trim() }),
            theme: this.options.theme,
            title: "Custom invocation",
            tui: this.options.tui,
          }),
      },
      this.toggle(
        "blockOnBlocked",
        "Block on critical advice",
        "Block the agent when the Advisor returns a critical decision.",
        this.settings.blockOnBlocked,
        true
      ),
      this.toggle(
        "autoLoopGate",
        "Automatic loop gate",
        "Ask the Advisor to review repeated equivalent attempts.",
        this.settings.autoLoopGate,
        true
      ),
      {
        currentValue: `After ${this.settings.loopThreshold ?? 3} repeats`,
        description: "Number of equivalent attempts before automatic review.",
        id: "loopThreshold",
        label: "Loop threshold",
        values: numericValues(
          this.settings.loopThreshold ?? 3,
          Array.from({ length: 99 }, (_, index) => index + 2)
        ).map((value) => `After ${value} repeats`),
      },
      {
        currentValue:
          this.settings.maxCallsPerSession === undefined
            ? "∞"
            : String(this.settings.maxCallsPerSession),
        description: "Limit automatic Advisor calls in one session.",
        id: "maxCallsPerSession",
        label: "Max Advisor calls/session",
        values: withCurrentValue(
          this.settings.maxCallsPerSession === undefined
            ? "∞"
            : String(this.settings.maxCallsPerSession),
          ["∞", "0", "1", "2", "3", "5", "10", "25", "50"]
        ),
      },
      this.toggle(
        "sessionSummary",
        "Session Advisor Summary",
        "Show a local summary when the session ends.",
        this.settings.sessionSummary,
        false
      ),
      {
        currentValue: this.settings.failureMode ?? "block-session",
        description: "Choose what happens when an Advisor gate fails.",
        id: "failureMode",
        label: "Gate failure mode",
        values: withCurrentValue(this.settings.failureMode ?? "block-session", [
          "block-session",
          "block-tool",
          "warn-and-continue",
        ]),
      },
      this.toggle(
        "herdrIntegration",
        "Herdr integration",
        "Send Advisor activity to the optional Herdr integration.",
        this.settings.herdrIntegration,
        true
      ),
      {
        currentValue: String(this.settings.toolResultMaxLines ?? 2000),
        description: "Maximum lines included from a tool result.",
        id: "toolResultMaxLines",
        label: "Tool result lines",
        values: numericValues(
          this.settings.toolResultMaxLines ?? 2000,
          [0, 500, 1000, 2000, 5000, 10_000]
        ),
      },
      {
        currentValue: String(this.settings.toolResultMaxBytes ?? 50 * 1024),
        description: "Maximum bytes included from a tool result.",
        id: "toolResultMaxBytes",
        label: "Tool result bytes",
        values: numericValues(this.settings.toolResultMaxBytes ?? 50 * 1024, [
          0,
          10 * 1024,
          50 * 1024,
          100 * 1024,
          500 * 1024,
        ]),
      },
      this.toggle(
        "redactSecrets",
        "Redact common secrets",
        "Redact common credential patterns before Advisor calls.",
        this.settings.redactSecrets,
        false
      ),
      {
        currentValue: this.settings.gitContext ?? "summary",
        description: "How much repository context is shared with the Advisor.",
        id: "gitContext",
        label: "Repository context",
        values: withCurrentValue(this.settings.gitContext ?? "summary", [
          "off",
          "summary",
          "full",
        ]),
      },
      {
        currentValue: String(this.settings.gitContextMaxChars ?? 20_000),
        description: "Maximum repository context characters included.",
        id: "gitContextMaxChars",
        label: "Repository context chars",
        values: numericValues(
          this.settings.gitContextMaxChars ?? 20_000,
          [0, 5000, 10_000, 20_000, 50_000, 100_000]
        ),
      },
      {
        currentValue: Object.keys(this.settings.toolPolicies ?? {}).length
          ? "Configured"
          : "All tools: full",
        description:
          "Choose which tools are shared in full, summarized, or excluded.",
        id: "toolPolicies",
        label: "Tool disclosure policies",
        submenu: (_currentValue, done) =>
          new TextSettingSubmenu({
            description:
              'Enter a JSON object with "full", "summary", or "exclude" values.',
            initial: JSON.stringify(this.settings.toolPolicies ?? {}),
            onCancel: done,
            onSubmit: (value) => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(value || "{}");
              } catch {
                return { error: "Enter a valid JSON object." };
              }
              if (!isValidAdvisorToolPolicies(parsed)) {
                return {
                  error:
                    "Use non-empty tool names with full, summary, or exclude values.",
                };
              }
              return { value: JSON.stringify(parsed) };
            },
            theme: this.options.theme,
            title: "Tool disclosure policies",
            tui: this.options.tui,
          }),
      },
      this.toggle(
        "trackedFileContent",
        "Tracked file content",
        "Allow tracked file contents to be sent with Advisor context.",
        this.settings.trackedFileContent,
        false
      ),
      this.toggle(
        "untrackedContent",
        "Untracked file content",
        "Allow untracked file contents to be sent with Advisor context.",
        this.settings.untrackedContent,
        false
      ),
      this.toggle(
        "outcomeLogging",
        "Outcome logging (global)",
        "Allow anonymized Advisor outcomes to be logged globally.",
        this.settings.outcomeLogging,
        false
      )
    );
    return items;
  }

  private toggle(
    id: string,
    label: string,
    description: string,
    value: boolean | undefined,
    defaultValue: boolean
  ): SettingItem {
    return {
      currentValue: settingValue(value, defaultValue),
      description,
      id,
      label,
      values: TOGGLE_VALUES,
    };
  }

  private currentContextLabel(): string {
    return (
      this.presets.find(
        (preset) => preset.value === this.settings.contextMaxChars
      )?.label ?? String(this.settings.contextMaxChars)
    );
  }

  private contextDescription(): string {
    const selectedIndex = Math.max(
      0,
      this.presets.findIndex(
        (preset) => preset.value === this.settings.contextMaxChars
      )
    );
    const pyramidRows = 5;
    const selectedPreset = this.presets[selectedIndex];
    const isFullContext =
      selectedPreset?.value === Number.MAX_SAFE_INTEGER ||
      selectedPreset?.label.toUpperCase() === "FULL" ||
      selectedPreset?.label.toUpperCase() === "ALL";
    const builtRows = isFullContext
      ? pyramidRows
      : Math.round(
          (selectedIndex / Math.max(1, this.presets.length - 1)) * pyramidRows
        );
    const pyramid = Array.from({ length: pyramidRows }, (_, row) => {
      const width = row * 2 + 1;
      const blocks = row >= pyramidRows - builtRows ? "█" : "·";
      return `${" ".repeat(pyramidRows - row - 1)}${blocks.repeat(width)}`;
    }).join("\n");
    return `${selectedPreset?.description ?? "Custom context limit."}\n${pyramid}\n  ${this.currentContextLabel()} context`;
  }

  private currentEffort(): string {
    return this.settings.effort || DEFAULT_EFFORT_LEVEL;
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

  private change(id: string, value: string): void {
    switch (id) {
      case "context":
        this.settings.contextMaxChars =
          this.presets.find((preset) => preset.label === value)?.value ??
          this.settings.contextMaxChars;
        break;
      case "simpleMode":
        this.settings.simpleMode = value === "On";
        if (this.settings.simpleMode) {
          this.startSimpleModeGradient();
        } else {
          this.stopSimpleModeGradient();
        }
        break;
      case "alwaysOn":
        this.settings.alwaysOn = value === "On";
        break;
      case "effort":
        this.settings.effort = value;
        break;
      case "customRule":
        this.settings.customRule = value.trim() || undefined;
        break;
      case "toolPolicies":
        this.settings.toolPolicies = JSON.parse(
          value
        ) as AdvisorSettings["toolPolicies"];
        break;
      case "loopThreshold":
        this.settings.loopThreshold = Number(
          value.replace("After ", "").replace(" repeats", "")
        );
        break;
      case "maxCallsPerSession":
        this.settings.maxCallsPerSession =
          value === "∞" ? undefined : Number(value);
        break;
      case "failureMode":
        this.settings.failureMode = value as AdvisorSettings["failureMode"];
        break;
      case "gitContext":
        this.settings.gitContext = value as AdvisorSettings["gitContext"];
        break;
      case "toolResultMaxLines":
        this.settings.toolResultMaxLines = Number(value);
        break;
      case "toolResultMaxBytes":
        this.settings.toolResultMaxBytes = Number(value);
        break;
      case "gitContextMaxChars":
        this.settings.gitContextMaxChars = Number(value);
        break;
      default:
        if (BOOLEAN_SETTING_IDS.has(id)) {
          (this.settings as unknown as Record<string, SettingValue | boolean>)[
            id
          ] = value === "On";
        }
        break;
    }
    (this.options.onChange ?? this.options.onSave)?.({
      ...this.settings,
      showUsageDetails: this.settings.showUsageDetails ?? true,
      toolPolicies: { ...(this.settings.toolPolicies ?? {}) },
    });
    if (
      id === "context" ||
      id === "simpleMode" ||
      id === "customRule" ||
      id === "toolPolicies"
    ) {
      this.settingsList = this.createSettingsList(id);
    }
  }
}
