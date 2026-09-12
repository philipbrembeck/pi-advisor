import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { activateAdvisor } from "./activation.ts";
import { registerCommandLifecycle } from "./lifecycle.ts";
import { registerManualCommand } from "./manual-command.ts";
import { registerModelCommands } from "./model-commands.ts";
import { registerCommandRenderers } from "./renderers.ts";
import { createCommandRuntime } from "./runtime.ts";
import { registerSettingsCommands } from "./settings-commands.ts";
import type { CommandDependencies } from "./types.ts";

export const registerCommands = (
  pi: ExtensionAPI,
  dependencies: CommandDependencies = {}
) => {
  const runtime = createCommandRuntime(pi, dependencies);
  const activate = (args: string, ctx: ExtensionContext, announce = true) =>
    activateAdvisor(runtime, args, ctx, announce);

  registerCommandRenderers(runtime);
  registerCommandLifecycle(runtime, activate);
  registerManualCommand(runtime);
  registerModelCommands(runtime);
  registerSettingsCommands(runtime);
};
