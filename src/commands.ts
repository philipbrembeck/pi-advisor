// biome-ignore lint/performance/noBarrelFile: this facade intentionally preserves the public command module contract.
export { registerCommands } from "./commands/registration.js";
export type {
  CommandDependencies,
  ManualAdvisorProgressPhase,
  ManualAdvisorProgressState,
  ManualConsult,
  ThinkingLevel,
} from "./commands/types.js";
