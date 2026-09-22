import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { registerCommands } from "../src/commands.ts";
import { getConfiguredModelRefs } from "../src/commands/model-options.ts";
import { SearchableModelMultiSelector } from "../src/ui/model-multi-selector.ts";
import { SearchableModelSelector } from "../src/ui/model-selector.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { mockPi } from "./helpers/mock-pi.ts";

// SAFETY: theme stub implements only the bold/fg members the selectors render with.
const theme = {
  bold: (value: string) => value,
  fg: (_color: string, value: string) => value,
} as any;

// SAFETY: keybindings stub only needs matches() to deny every key sequence.
const keybindings = { matches: () => false } as any;

const runModelsCommand = async (agentDir: string) => {
  const commands = new Map<string, any>();
  const effortChoicesSeen: string[][] = [];
  registerCommands(mockPi({ commands }));
  await commands.get("advisor-models").handler(
    "",
    asExtensionContext({
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
              { requestRender: () => {} },
              theme,
              { matches: () => false },
              resolve
            );
            selector.render(100);
            selector.handleInput("\r");
          }),
        notify: () => {},
        select: (_title: string, choices: string[]) => {
          effortChoicesSeen.push(choices);
          return Promise.resolve(choices[0]);
        },
      },
    })
  );
  return {
    effortChoicesSeen,
    saved: JSON.parse(readFileSync(join(agentDir, "advisor.json"), "utf-8")),
  };
};

describe("Searchable model selector", () => {
  test("lists only models available from Pi's model registry", () => {
    const refs = getConfiguredModelRefs(
      asExtensionContext({
        modelRegistry: {
          getAll: () => [
            { id: "unavailable", provider: "provider" },
            { id: "first", provider: "provider" },
          ],
          getAvailable: () => [
            { id: "second", provider: "provider" },
            { id: "first", provider: "provider" },
            { id: "first", provider: "provider" },
          ],
        },
      })
    );
    expect(refs).toEqual(["provider/first", "provider/second"]);
  });

  test("shows the current model first and ticked", () => {
    const selector = new SearchableModelSelector({
      allOptions: ["provider/other", "provider/current", "provider/last"],
      currentOption: "provider/current",
      keybindings,
      onCancel: () => {},
      onSelect: () => {},
      theme,
      title: "Select Model",
      tui: { requestRender: () => {} },
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
      onCancel: () => {},
      onSelect: (value) => {
        selected = value;
      },
      theme,
      title: "Select Model",
      tui: { requestRender: () => {} },
    });

    const screen = selector.render(100).join("\n");
    expect(screen).not.toContain("provider/unavailable");
    selector.handleInput("\r");
    expect(selected).toBe("provider/available");
  });

  test("keeps saved and stale whitelist entries checked without duplicates", () => {
    let selected: string[] | undefined;
    const selector = new SearchableModelMultiSelector({
      allOptions: [
        "provider/alpha",
        "provider/beta",
        "provider/alpha",
        "provider/stale",
      ],
      currentOptions: ["provider/alpha", "provider/stale"],
      keybindings,
      multiSelect: true,
      onCancel: () => {},
      onSelect: (values) => {
        selected = values;
      },
      theme,
      title: "Advisor model whitelist",
      tui: { requestRender: () => {} },
    });

    const screen = selector.render(100).join("\n");
    expect(screen.match(/provider\/alpha/gu)).toHaveLength(1);
    expect(screen).toContain("✓ provider/alpha");
    expect(screen).toContain("✓ provider/stale");
    selector.handleInput("\r");
    expect(selected).toEqual(["provider/alpha", "provider/stale"]);
  });

  test("fuzzy-filters and toggles multiple models", () => {
    let selected: string[] | undefined;
    const selector = new SearchableModelMultiSelector({
      allOptions: [
        "anthropic/claude-sonnet-5",
        "openai-codex/gpt-5.6-luna",
        "openrouter/deepseek-v4",
      ],
      currentOptions: [],
      keybindings,
      multiSelect: true,
      onCancel: () => {},
      onSelect: (values) => {
        selected = values;
      },
      theme,
      title: "Advisor model whitelist",
      tui: { requestRender: () => {} },
    });

    selector.handleInput("s");
    selector.handleInput("o");
    selector.handleInput("n");
    expect(selector.render(100).join("\n")).toContain(
      "anthropic/claude-sonnet-5"
    );
    expect(selector.render(100).join("\n")).not.toContain(
      "openrouter/deepseek-v4"
    );
    selector.handleInput(" ");
    selector.handleInput("\r");
    expect(selected).toEqual(["anthropic/claude-sonnet-5"]);
  });

  test("applies selected models when the current search has no matches", () => {
    let selected: string[] | undefined;
    const selector = new SearchableModelMultiSelector({
      allOptions: ["provider/alpha", "provider/beta"],
      currentOptions: [],
      keybindings,
      multiSelect: true,
      onCancel: () => {},
      onSelect: (values) => {
        selected = values;
      },
      theme,
      title: "Advisor model whitelist",
      tui: { requestRender: () => {} },
    });

    selector.handleInput(" ");
    for (const character of "no-match") {
      selector.handleInput(character);
    }
    expect(selector.render(100).join("\n")).toContain(
      "No matching models found."
    );
    selector.handleInput("\r");

    expect(selected).toEqual(["provider/alpha"]);
  });

  test("keeps the current model when Enter is pressed immediately", () => {
    let selected: string | undefined;
    const selector = new SearchableModelSelector({
      allOptions: ["provider/other", "provider/current"],
      currentOption: "provider/current",
      keybindings,
      onCancel: () => {},
      onSelect: (value) => {
        selected = value;
      },
      theme,
      title: "Select Model",
      tui: { requestRender: () => {} },
    });

    selector.render(100);
    selector.handleInput("\r");
    expect(selected).toBe("provider/current");
  });
});

describe("Advisor model command thinking levels", () => {
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
