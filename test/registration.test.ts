import { expect, test, describe } from "bun:test";
import registerExtension from "../extensions/index.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

describe("Extension Registration", () => {
  test("should register advisor tool and commands correctly", () => {
    const registeredTools: string[] = [];
    const registeredCommands: string[] = [];

    const mockPi = {
      registerTool(tool: any) {
        registeredTools.push(tool.name);
      },
      registerCommand(name: string, _config: any) {
        registeredCommands.push(name);
      },
      getActiveTools() {
        return [];
      }
    } as unknown as ExtensionAPI;

    registerExtension(mockPi);

    // Verify tool registered
    expect(registeredTools).toContain("ask_advisor");

    // Verify all commands registered
    expect(registeredCommands).toContain("advisor");
    expect(registeredCommands).toContain("advisor-models");
    expect(registeredCommands).toContain("advisor-off");
  });
});
