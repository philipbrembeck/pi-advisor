// biome-ignore lint/performance/noBarrelFile: this facade intentionally preserves the public UI module contract.
export { ManualAdvisorDialog } from "./ui/manual-dialog.ts";
export { SearchableModelSelector } from "./ui/model-selector.ts";
export { AdvisorSettingsSelector } from "./ui/settings-selector.ts";
export type {
  AdvisorSettings,
  ContextPreset,
  ManualAdvisorRequest,
} from "./ui/types.ts";
