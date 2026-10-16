import { describe, expect, test } from "bun:test";

import type { ClassifierModel } from "@earendil-works/pi-ai";

import { JevFilterSubmenu } from "../src/ui/jev-filter-submenu.ts";
import type { JevFilterSelection, JevSetupDeps } from "../src/ui/types.ts";
import { plainThemeMock } from "./helpers/theme.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const open = (
  options: {
    currentValue?: string;
    deps?: JevSetupDeps;
    onSelection?: (selection: JevFilterSelection) => boolean;
  } = {}
) => {
  const selections: JevFilterSelection[] = [];
  const done: (string | undefined)[] = [];

  const submenu = new JevFilterSubmenu({
    currentClassifier: "typesafe/jev-latest",
    currentValue: options.currentValue ?? "Off",
    done: (value) => done.push(value),
    modelRegistry: options.deps?.modelRegistry,
    onSelection: (selection) => {
      selections.push(selection);

      return options.onSelection ? options.onSelection(selection) : true;
    },
    theme: plainThemeMock,
    tui: { requestRender: () => undefined },
  });

  return { done, selections, submenu };
};

const resolved = (): JevSetupDeps => ({
  modelRegistry: {
    classify: async () => {
      throw new Error("unused");
    },
    findOfType: () => undefined,
    getAvailableOfType: async () => [
      {
        api: "typesafe-classifier",
        baseUrl: "https://classifier.example.test",
        contextWindow: 10,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "jev-latest",
        input: ["text"],
        name: "Jev Latest",
        provider: "typesafe",
        type: "classifier",
      } satisfies ClassifierModel<"typesafe-classifier">,
    ],
    getProviderDisplayName: () => "TypeSafe",
  } satisfies NonNullable<JevSetupDeps["modelRegistry"]>,
});

const nothingResolves = (): JevSetupDeps => ({
  modelRegistry: {
    classify: async () => {
      throw new Error("unused");
    },
    findOfType: () => undefined,
    getAvailableOfType: async () => [],
    getProviderDisplayName: () => "TypeSafe",
  } satisfies NonNullable<JevSetupDeps["modelRegistry"]>,
});

describe("JevFilterSubmenu", () => {
  test("enables the filter without touching the provider selection", async () => {
    const { done, selections, submenu } = open({ deps: resolved() });
    await settle();
    submenu.handleInput("\r");
    await settle();

    expect(selections).toEqual([{ enabled: true }]);
    expect(done).toEqual(["On"]);
  });

  test("refuses to enable while no provider resolves", async () => {
    const { selections, submenu } = open({ deps: nothingResolves() });
    await settle();
    submenu.handleInput("\r");
    await settle();

    expect(selections).toEqual([]);
    // SAFETY: the component exposes its current notice for assertions.
    expect((submenu as any).notice).toContain(
      "Select an available authenticated classifier"
    );
  });

  test("disables an already enabled filter", async () => {
    const { done, selections, submenu } = open({
      currentValue: "On",
      deps: resolved(),
    });

    await settle();
    submenu.handleInput("\r");
    await settle();

    expect(selections).toEqual([{ enabled: false }]);
    expect(done).toEqual(["Off"]);
  });

  test("a rejected save keeps the filter off and reports it", async () => {
    const { done, selections, submenu } = open({
      deps: resolved(),
      onSelection: () => false,
    });

    await settle();
    submenu.handleInput("\r");
    await settle();

    expect(selections).toEqual([{ enabled: true }]);
    expect(done).toEqual([]);
    // SAFETY: the component keeps its pre-save local state on a rejected save.
    expect((submenu as any).enabled).toBe(false);
    // SAFETY: the component exposes its current notice for assertions.
    expect((submenu as any).notice).toBe(
      "The filter state could not be saved."
    );
  });

  test("reports a credential lookup failure instead of enabling", async () => {
    const { selections, submenu } = open({
      deps: {
        modelRegistry: {
          classify: async () => {
            throw new Error("unused");
          },
          findOfType: () => undefined,
          getAvailableOfType: async () => {
            throw new Error("model registry unavailable");
          },
          getProviderDisplayName: () => "TypeSafe",
        } satisfies NonNullable<JevSetupDeps["modelRegistry"]>,
      },
    });

    await settle();
    submenu.handleInput("\r");
    await settle();

    expect(selections).toEqual([]);
    // SAFETY: the component exposes its current notice for assertions.
    expect((submenu as any).notice).toContain("model registry unavailable");
  });
});
