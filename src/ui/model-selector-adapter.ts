import type { Component, Focusable } from "@earendil-works/pi-tui";

import type { SearchableModelList } from "./searchable-model-list.ts";

export class ModelSelectorAdapter implements Component, Focusable {
  protected readonly list: SearchableModelList;

  constructor(list: SearchableModelList) {
    this.list = list;
  }

  get focused(): boolean {
    return this.list.focused;
  }

  set focused(value: boolean) {
    this.list.focused = value;
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    return this.list.render(width);
  }

  handleInput(keyData: string): void {
    this.list.handleInput(keyData);
  }
}
