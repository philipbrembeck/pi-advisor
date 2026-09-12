import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerCommands } from "../src/commands.ts";
import { SearchableModelSelector } from "../src/ui.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { mockPi } from "./helpers/mock-pi.ts";

describe("Searchable model selector", () => {
  const theme = {
    bold: (value: string) => value,
    fg: (_color: string, value: string) => value,
  } as any;
  const keybindings = { matches: () => false } as any;

  test("shows the current model first and ticked", () => {
    const selector = new SearchableModelSelector({
      allOptions: ["provider/other", "provider/current", "provider/last"],
      currentOption: "provider/current",
      keybindings,
      onCancel: () => undefined,
      onSelect: () => undefined,
      theme,
      title: "Select Model",
      tui: { requestRender: () => undefined },
    });

    const screen = selector.render(100).join("\n");
    expect(screen.indexOf("✓ provider/current")).toBeLessThan(
      screen.indexOf("provider/other")
    );
  });

  test("does not show a configured model that is unavailable", () => {
    let selected: string | undefined;
    const selector = new SearchableModelSelector({
      allOptions: ["provider/available"],
      currentOption: "provider/unavailable",
      keybindings,
      onCancel: () => undefined,
      onSelect: (value) => {
        selected = value;
      },
      theme,
      title: "Select Model",
      tui: { requestRender: () => undefined },
    });

    const screen = selector.render(100).join("\n");
    expect(screen).not.toContain("provider/unavailable");
    selector.handleInput("\r");
    expect(selected).toBe("provider/available");
  });

  test("keeps the current model when Enter is pressed immediately", () => {
    let selected: string | undefined;
    const selector = new SearchableModelSelector({
      allOptions: ["provider/other", "provider/current"],
      currentOption: "provider/current",
      keybindings,
      onCancel: () => undefined,
      onSelect: (value) => {
        selected = value;
      },
      theme,
      title: "Select Model",
      tui: { requestRender: () => undefined },
    });

    selector.render(100);
    selector.handleInput("\r");
    expect(selected).toBe("provider/current");
  });
});

describe("Advisor model command thinking levels", () => {
  const runModelsCommand = async (agentDir: string) => {
    const commands = new Map<string, any>();
    const effortChoicesSeen: string[][] = [];
    const theme = {
      bold: (value: string) => value,
      fg: (_color: string, value: string) => value,
    } as any;
    registerCommands(mockPi({ commands }));
    await commands.get("advisor-models").handler("", {
      cwd: agentDir,
      hasUI: true,
      isProjectTrusted: () => false,
      modelRegistry: {
        getAvailable: () => [
          { id: "executor", provider: "provider" },
          { id: "advisor", provider: "provider" },
        ],
      },
      ui: {
        custom: (factory: any) =>
          new Promise((resolve) => {
            const selector = factory(
              { requestRender: () => undefined },
              theme,
              { matches: () => false },
              resolve
            );
            selector.render(100);
            selector.handleInput("\r");
          }),
        notify: () => undefined,
        select: (_title: string, choices: string[]) => {
          effortChoicesSeen.push(choices);
          return Promise.resolve(choices[0]);
        },
      },
    } as any);
    return {
      effortChoicesSeen,
      saved: JSON.parse(readFileSync(join(agentDir, "advisor.json"), "utf8")),
    };
  };

  test("shows configured levels first in the effort choices", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorEffort: "high",
        executor: "provider/executor",
        executorEffort: "low",
      },
      async (agentDir) => {
        const { effortChoicesSeen } = await runModelsCommand(agentDir);
        expect(effortChoicesSeen).toEqual([
          [
            "✓ low",
            "Default (Model Default)",
            "off",
            "minimal",
            "medium",
            "high",
            "xhigh",
            "max",
          ],
          [
            "✓ high",
            "Default (Model Default)",
            "off",
            "minimal",
            "low",
            "medium",
            "xhigh",
            "max",
          ],
        ]);
      }
    );
  });

  test("keeps the configured effort levels on Enter", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorEffort: "high",
        executor: "provider/executor",
        executorEffort: "low",
      },
      async (agentDir) => {
        const { saved } = await runModelsCommand(agentDir);
        expect(saved.executorEffort).toBe("low");
        expect(saved.advisorEffort).toBe("high");
      }
    );
  });
});
