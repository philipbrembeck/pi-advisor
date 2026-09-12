import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Focusable,
  SettingsList,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import {
  rainbowGradient,
  SIMPLE_MODE_GRADIENT_INTERVAL_MS,
} from "./settings-formatting.ts";
import { createSettingsItems } from "./settings-items.ts";
import { SettingsListAdapter } from "./settings-list-adapter.ts";
import { mutateAdvisorSettings } from "./settings-mutations.ts";
import type {
  AdvisorSettings,
  AdvisorSettingsSelectorOptions,
  ContextPreset,
} from "./types.ts";

export class AdvisorSettingsSelector implements Component, Focusable {
  private readonly options: AdvisorSettingsSelectorOptions;
  private readonly settings: AdvisorSettings;
  private readonly presets: ContextPreset[];
  private settingsList: SettingsListAdapter;
  private simpleModeGradientStartedAt: number | undefined;
  private simpleModeGradientTimer: ReturnType<typeof setInterval> | undefined;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.settingsList.setFocused(value);
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
    if (
      !this.settingsList.changeWithArrow(keyData, (id, value) =>
        this.change(id, value)
      )
    ) {
      this.settingsList.handleInput(keyData);
    }
    this.options.tui.requestRender();
  }

  private createSettingsList(selectedId?: string): SettingsListAdapter {
    const listTheme = getSettingsListTheme();
    const defaultLabel = listTheme.label;
    listTheme.label = (text, selected) => {
      if (this.settings.simpleMode && text.startsWith("Simple mode")) {
        return `${rainbowGradient("Simple mode", this.simpleModeGradientStartedAt ?? 0)}${text.slice("Simple mode".length)}`;
      }
      return defaultLabel(text, selected);
    };
    const items = createSettingsItems({
      effortLevels: this.options.effortLevels,
      presets: this.presets,
      settings: this.settings,
      theme: this.options.theme,
      tui: this.options.tui,
    });
    const list = new SettingsList(
      items,
      10,
      listTheme,
      (id, value) => this.change(id, value),
      this.options.onCancel,
      { enableSearch: true }
    );
    const adapter = new SettingsListAdapter(list);
    if (selectedId) {
      adapter.setSelectedId(items, selectedId);
    }
    return adapter;
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
    mutateAdvisorSettings(this.settings, id, value, this.presets);
    if (id === "simpleMode") {
      if (this.settings.simpleMode) {
        this.startSimpleModeGradient();
      } else {
        this.stopSimpleModeGradient();
      }
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
