import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface MockPiCapture {
  /** Tool names returned by getActiveTools; mutable when passed in. */
  activeTools?: string[];
  /** Registered command configs by name. */
  commands?: Map<string, any>;
  /** Captured transcript entries, in append order. */
  entries?: { data: unknown; type: string }[];
  /** Registered entry renderers by entry type. */
  entryRenderers?: Map<string, any>;
  /** Registered event handlers by event name. */
  events?: Map<string, any>;
  /** Registered message renderers by custom message type. */
  messageRenderers?: Map<string, any>;
  /** Captured executor-bound messages with their send options. */
  sent?: { message: any; options: any }[];
  /** Registered tools by tool name. */
  tools?: Map<string, any>;
}

/**
 * Builds an ExtensionAPI stand-in for registration tests. Each collector
 * passed in activates the matching surface; unpassed surfaces are inert
 * no-ops. Members of `overrides` replace the defaults wholesale.
 */
export const mockPi = <TOverrides extends object>(
  capture: MockPiCapture = {},
  overrides?: TOverrides
): ExtensionAPI => {
  const { activeTools, ...collectors } = capture;
  const tools = activeTools ?? [];
  const api = {
    appendEntry<T>(type: string, data: T) {
      collectors.entries?.push({ data, type });
    },
    getActiveTools: () => [...tools],
    on<T>(event: string, handler: T) {
      collectors.events?.set(event, handler);
    },
    registerCommand(name: string, config: any) {
      collectors.commands?.set(name, config);
    },
    registerEntryRenderer<T>(name: string, renderer: T) {
      collectors.entryRenderers?.set(name, renderer);
    },
    registerMessageRenderer<T>(type: string, renderer: T) {
      collectors.messageRenderers?.set(type, renderer);
    },
    registerTool(tool: { name: string }) {
      collectors.tools?.set(tool.name, tool);
    },
    sendMessage<T>(message: T, options: any) {
      collectors.sent?.push({ message, options });
    },
    setActiveTools(next: string[]) {
      tools.splice(0, tools.length, ...next);
    },
    ...overrides,
  };
  // SAFETY: mock implements the ExtensionAPI registration surface tests consume; overrides replace members.
  return api as ExtensionAPI;
};
