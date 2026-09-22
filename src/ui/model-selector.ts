import type { Component, Focusable } from "@earendil-works/pi-tui";

import { SearchableModelList } from "./searchable-model-list.ts";
import type {
  SearchableModelMultiSelectorOptions,
  SearchableModelSelectorOptions,
} from "./types.ts";

class ModelSelectorAdapter implements Component, Focusable {
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

export class SearchableModelSelector extends ModelSelectorAdapter {
  constructor(options: SearchableModelSelectorOptions) {
    super(
      new SearchableModelList({
        ...options,
        currentOptions: options.currentOption ? [options.currentOption] : [],
        multiSelect: false,
        onSelect: ([value]) => {
          if (value !== undefined) {
            options.onSelect(value);
          }
        },
      })
    );
  }
}

export class SearchableModelMultiSelector extends ModelSelectorAdapter {
  constructor(options: SearchableModelMultiSelectorOptions) {
    super(new SearchableModelList(options));
  }
}
