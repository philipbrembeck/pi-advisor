import { ModelSelectorAdapter } from "./model-selector-adapter.ts";
import { SearchableModelList } from "./searchable-model-list.ts";
import type { SearchableModelSelectorOptions } from "./types.ts";

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
