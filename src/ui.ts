// biome-ignore lint/performance/noBarrelFile: this facade intentionally preserves the public UI module contract.
export { ManualAdvisorDialog } from "./ui/manual-dialog.js";
export { SearchableModelSelector } from "./ui/model-selector.js";
export { AdvisorSettingsSelector } from "./ui/settings-selector.js";
export type {
  AdvisorSettings,
  ContextPreset,
  ManualAdvisorRequest,
} from "./ui/types.js";
