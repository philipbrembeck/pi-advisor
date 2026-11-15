import type { SelectAdvisorModels } from "../../src/commands/configuration-tool-models.ts";
import { registerAdvisorConfigurationTool } from "../../src/commands/configuration-tool.ts";
import { createCommandRuntime } from "../../src/commands/runtime.ts";
import type { CommandRuntime } from "../../src/commands/types.ts";
import { asExtensionContext } from "./extension-context.ts";
import { mockPi } from "./mock-pi.ts";

export const makeUiContext = (
  agentDir: string,
  options: {
    confirm?: (title: string, body: string) => Promise<boolean>;
    hasUI?: boolean;
    mode?: "tui" | "rpc" | "print";
    models?: { id: string; provider: string }[];
    notify?: (message: string) => void;
  } = {}
) => {
  const notifications: string[] = [];
  const confirmations: { body: string; title: string }[] = [];
  const models = options.models ?? [];

  const ctx = {
    cwd: agentDir,
    hasUI: options.hasUI ?? true,
    isProjectTrusted: () => false,
    mode: options.mode ?? "tui",
    modelRegistry: {
      find: (provider: string, id: string) =>
        models.find((model) => model.provider === provider && model.id === id),
      getAvailable: () => models,
    },
    ui: {
      confirm: async (title: string, body: string) => {
        confirmations.push({ body, title });

        return options.confirm ? options.confirm(title, body) : true;
      },
      custom: async () => undefined,
      notify: (message: string) => {
        notifications.push(message);
        options.notify?.(message);
      },
      setStatus: () => undefined,
    },
  };

  return { confirmations, ctx: asExtensionContext(ctx), notifications };
};

export const registerTool = (
  options: {
    activeTools?: string[];
    selectModels?: SelectAdvisorModels;
  } = {}
) => {
  const tools = new Map<string, any>();

  const pi = mockPi(
    { activeTools: options.activeTools ?? ["bash"], tools },
    {
      setModel: () => Promise.resolve(true),
      setThinkingLevel: () => undefined,
    }
  );

  const runtime: CommandRuntime = createCommandRuntime(pi);

  registerAdvisorConfigurationTool(runtime, {
    selectModels: options.selectModels,
  });

  return { runtime, tool: tools.get("advisor_config") };
};
