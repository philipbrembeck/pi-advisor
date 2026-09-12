import { type ExtensionAPI, initTheme } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import { registerCommands } from "../../src/commands.ts";
import type { AdvisorSessionState } from "../../src/session-state.ts";
import { mockPi } from "./mock-pi.ts";

initTheme();

export const modalTheme = {
  bg: (_color: string, value: string) => value,
  bold: (value: string) => value,
  fg: (_color: string, value: string) => value,
} as any;

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
  const entries: Array<{ data: unknown; type: string }> = [];
  const entryRenderers = new Map<string, any>();
  const modalOptions: any[] = [];
  const notices: string[] = [];
  const sent: Array<{ message: any; options: any }> = [];
  const statuses: Array<string | undefined> = [];
  const mockPiApi = mockPi({ commands, entries, entryRenderers, events, sent });
  const ctx = {
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
  } as any;
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
      setModel: () => Promise.resolve(true),
      setThinkingLevel: () => undefined,
    }
  ) as unknown as ExtensionAPI;
  return {
    commands,
    events,
    pi,
    renderers,
    setActiveTools: (tools: string[]) => {
      activeTools.splice(0, activeTools.length, ...tools);
    },
  };
};

/**
 * Activation-command context with a model registry over `models` and a
 * notify collector.
 */
export const activationContext = (
  agentDir: string,
  notes: string[] = [],
  models?: Array<{ id: string; provider: string }>
) =>
  ({
    cwd: agentDir,
    hasUI: true,
    isProjectTrusted: () => false,
    modelRegistry: {
      find: (provider: string, id: string) =>
        models
          ? models.find(
              (model) => model.provider === provider && model.id === id
            )
          : { id, provider },
      getApiKeyAndHeaders: () => Promise.resolve({ apiKey: "key", ok: true }),
      ...(models ? { getAvailable: () => models } : {}),
    },
    ui: { notify: (message: string) => notes.push(message) },
  }) as any;
