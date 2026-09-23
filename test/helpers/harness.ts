import { initTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";

import { registerCommands } from "../../src/commands.ts";
import type { AdvisorSessionState } from "../../src/session-state.ts";
import { asExtensionContext } from "./extension-context.ts";
import { mockPi } from "./mock-pi.ts";

initTheme();

export const modalTheme = {
  bg: (_color: string, value: string) => value,
  bold: (value: string) => value,
  fg: (_color: string, value: string) => value,
};

export const plainTheme = modalTheme;

/**
 * Registers the advisor commands against a mock pi and returns every
 * observable surface: captured commands, transcript entries, renderers,
 * session events, modal options, notices, sent messages, and manual-status
 * values. `drive` receives the constructed modal dialog component.
 */
export const modalHarness = (
  agentDir: string,
  state: AdvisorSessionState,
  drive: (dialog: any) => void,
  consult: (...args: any[]) => Promise<any>,
  mode: "rpc" | "tui" = "tui"
) => {
  const commands = new Map<string, any>();
  const events = new Map<string, any>();
  const entries: { data: unknown; type: string }[] = [];
  const entryRenderers = new Map<string, any>();
  const modalOptions: any[] = [];
  const notices: string[] = [];
  const sent: { message: any; options: any }[] = [];
  const statuses: (string | undefined)[] = [];
  const mockPiApi = mockPi({ commands, entries, entryRenderers, events, sent });
  const ctx = asExtensionContext({
    cwd: agentDir,
    hasUI: true,
    isProjectTrusted: () => false,
    mode,
    ui: {
      custom: (factory: any, options: any) =>
        new Promise((resolve) => {
          modalOptions.push(options);
          const dialog = factory(
            { requestRender: () => undefined, terminal: { rows: 24 } },
            modalTheme,
            getKeybindings(),
            resolve
          );
          dialog.focused = true;
          drive(dialog);
        }),
      notify: (message: string) => notices.push(message),
      setStatus: (key: string, value: string | undefined) => {
        if (key === "advisor-manual") {
          statuses.push(value);
        }
      },
    },
  });
  registerCommands(mockPiApi, { consult, sessionState: state });
  return {
    commands,
    ctx,
    entries,
    entryRenderers,
    events,
    modalOptions,
    notices,
    sent,
    statuses,
  };
};

/**
 * Registers commands and lifecycle tools against a mock pi whose active
 * tools start enabled, and exposes the event/renderers maps plus mutable
 * active-tools control used by activation tests.
 */
export const activationHarness = () => {
  const commands = new Map<string, any>();
  const events = new Map<string, (event: any, ctx: any) => any>();
  const renderers = new Map<string, any>();
  const activeTools = ["ask_advisor"];
  const selectedModels: unknown[] = [];
  const thinkingLevels: unknown[] = [];
  const pi = mockPi(
    { commands, events, messageRenderers: renderers },
    {
      getActiveTools: () => activeTools,
      registerEntryRenderer: () => undefined,
      registerMessageRenderer(type: string, renderer: any) {
        renderers.set(type, renderer);
      },
      registerTool: () => undefined,
      sendMessage: () => undefined,
      setActiveTools(tools: string[]) {
        activeTools.splice(0, activeTools.length, ...tools);
      },
      setModel: (model: Parameters<ExtensionAPI["setModel"]>[0]) => {
        selectedModels.push(model);
        return Promise.resolve(true);
      },
      setThinkingLevel: (
        level: Parameters<ExtensionAPI["setThinkingLevel"]>[0]
      ) => {
        thinkingLevels.push(level);
      },
    }
  );
  return {
    commands,
    events,
    pi,
    renderers,
    selectedModels,
    setActiveTools: (tools: string[]) => {
      activeTools.splice(0, activeTools.length, ...tools);
    },
    thinkingLevels,
  };
};

interface RegistryModel {
  id: string;
  provider: string;
}

interface ActivationModelRegistry {
  find: (provider: string, id: string) => RegistryModel | undefined;
  getApiKeyAndHeaders: () => Promise<{ apiKey: string; ok: boolean }>;
  getAvailable?: () => RegistryModel[];
}

/** Activation-command context with a model registry over `models`. */
export const activationContext = (
  agentDir: string,
  notes: string[] = [],
  models?: RegistryModel[]
) => {
  const registry: ActivationModelRegistry = {
    find: (provider: string, id: string) =>
      models
        ? models.find((model) => model.provider === provider && model.id === id)
        : { id, provider },
    getApiKeyAndHeaders: () => Promise.resolve({ apiKey: "key", ok: true }),
  };
  if (models) {
    registry.getAvailable = () => models;
  }
  return asExtensionContext({
    cwd: agentDir,
    hasUI: true,
    isProjectTrusted: () => false,
    modelRegistry: registry,
    ui: { notify: (message: string) => notes.push(message) },
  });
};
