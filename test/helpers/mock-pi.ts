import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface MockPiCapture {
  /** Tools returned by getActiveTools; mutable when passed in. */
  activeTools?: string[];
  /** Registered command configs by name. */
  commands?: Map<string, any>;
  /** Captured transcript entries, in append order. */
  entries?: Array<{ data: unknown; type: string }>;
  /** Registered entry renderers by entry type. */
  entryRenderers?: Map<string, any>;
  /** Registered event handlers by event name. */
  events?: Map<string, any>;
  /** Registered message renderers by custom message type. */
  messageRenderers?: Map<string, any>;
  /** Captured executor-bound messages with their send options. */
  sent?: Array<{ message: any; options: any }>;
  /** Registered tools by tool name. */
  tools?: Map<string, any>;
}

/**
 * Builds an ExtensionAPI stand-in for registration tests. Each collector
 * passed in activates the matching surface; unprovided surfaces are inert
 * no-ops. Extra keys in `overrides` replace the defaults entirely.
 */
export const mockPi = (
  capture: MockPiCapture = {},
  overrides: Record<string, unknown> = {}
): ExtensionAPI => {
  const { activeTools, ...collectors } = capture;
  const tools = activeTools ?? [];
  return {
    appendEntry(type: string, data: unknown) {
      collectors.entries?.push({ data, type });
    },
    getActiveTools: () => [...tools],
    on(event: string, handler: unknown) {
      collectors.events?.set(event, handler);
    },
    registerCommand(name: string, config: unknown) {
      collectors.commands?.set(name, config);
    },
    registerEntryRenderer(name: string, renderer: unknown) {
      collectors.entryRenderers?.set(name, renderer);
    },
    registerMessageRenderer(type: string, renderer: unknown) {
      collectors.messageRenderers?.set(type, renderer);
    },
    registerTool(tool: { name: string }) {
      collectors.tools?.set(tool.name, tool);
    },
    sendMessage(message: unknown, options: unknown) {
      collectors.sent?.push({ message, options });
    },
    setActiveTools(next: string[]) {
      tools.splice(0, tools.length, ...next);
    },
    ...overrides,
  } as unknown as ExtensionAPI;
};
