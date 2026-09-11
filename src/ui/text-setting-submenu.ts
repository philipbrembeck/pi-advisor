import {
  type Component,
  type Focusable,
  Input,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { TextSettingSubmenuOptions } from "./types.js";

/** Small inline editor used by SettingsList for the two free-form settings. */
export class TextSettingSubmenu implements Component, Focusable {
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
    const before = this.input.getValue();
    this.input.handleInput(keyData);
    // A failed submit leaves the error visible; the first value change clears it.
    if (this.error && this.input.getValue() !== before) {
      this.error = undefined;
    }
  }
}
