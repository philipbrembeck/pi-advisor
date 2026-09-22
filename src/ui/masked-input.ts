import { Input, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component, Focusable } from "@earendil-works/pi-tui";

export interface MaskedInputOptions {
  onEscape?: () => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
}

type InputWithCursor = Input & { cursor: number };

/** Single-line secret input rendering bullets; the value never reaches the screen. */
export class MaskedInput implements Component, Focusable {
  private readonly input: Input;
  private readonly options: MaskedInputOptions;
  private _focused = true;

  constructor(options: MaskedInputOptions = {}) {
    this.options = options;
    this.input = new Input({ placeholder: options.placeholder });
    this.input.focused = true;
    this.input.onSubmit = (value) => options.onSubmit?.(value);
    this.input.onEscape = () => options.onEscape?.();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  getValue(): string {
    return this.input.getValue();
  }

  setValue(value: string): void {
    this.input.setValue(value);
  }

  handleInput(keyData: string): void {
    this.input.handleInput(keyData);
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    const value = this.input.getValue();
    // SAFETY: compatibility-only read of Input's private cursor; Input does not expose it.
    const { cursor } = this.input as InputWithCursor;
    const masked = `${"•".repeat(Math.min(cursor, value.length))}█${"•".repeat(Math.max(0, value.length - cursor))}`;
    const placeholder =
      value.length === 0 && this.options.placeholder
        ? this.options.placeholder
        : masked;
    return [truncateToWidth(placeholder, Math.max(1, width))];
  }
}
