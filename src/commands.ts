// biome-ignore lint/performance/noBarrelFile: this facade intentionally preserves the public command module contract.
export { registerCommands } from "./commands/registration.ts";
export type {
  CommandDependencies,
  ManualAdvisorProgressPhase,
  ManualAdvisorProgressState,
  ManualConsult,
  ThinkingLevel,
} from "./commands/types.ts";
