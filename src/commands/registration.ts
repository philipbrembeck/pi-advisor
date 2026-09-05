import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { activateAdvisor } from "./activation.js";
import { registerCommandLifecycle } from "./lifecycle.js";
import { registerManualCommand } from "./manual-command.js";
import { registerModelCommands } from "./model-commands.js";
import { registerCommandRenderers } from "./renderers.js";
import { createCommandRuntime } from "./runtime.js";
import { registerSettingsCommands } from "./settings-commands.js";
import type { CommandDependencies } from "./types.js";

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
