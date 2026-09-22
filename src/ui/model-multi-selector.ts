import { ModelSelectorAdapter } from "./model-selector-adapter.ts";
import { SearchableModelList } from "./searchable-model-list.ts";
import type { SearchableModelMultiSelectorOptions } from "./types.ts";

export class SearchableModelMultiSelector extends ModelSelectorAdapter {
  constructor(options: SearchableModelMultiSelectorOptions) {
    super(new SearchableModelList(options));
  }
}
