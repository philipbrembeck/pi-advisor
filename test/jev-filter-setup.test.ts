import { describe, expect, test } from "bun:test";

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
  const submenu = new JevFilterSubmenu(
    {
      currentTransport: "typesafe",
      currentValue: options.currentValue ?? "Off",
      done: (value) => done.push(value),
      onSelection: (selection) => {
        selections.push(selection);
        return options.onSelection ? options.onSelection(selection) : true;
      },
      setupDeps: options.deps,
      theme: plainThemeMock,
      tui: { requestRender: () => undefined },
    },
    {}
  );
  return { done, selections, submenu };
};

const resolved = (): JevSetupDeps => ({
  resolveTransport: () =>
    Promise.resolve({ apiKey: "verified-key", transport: "typesafe" }),
});

const nothingResolves = (): JevSetupDeps => ({
  resolveTransport: () => Promise.resolve(undefined),
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
    expect((submenu as any).notice).toContain("No Jev provider resolves");
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
        resolveTransport: () => Promise.reject(new Error("keychain locked")),
      },
    });
    await settle();
    submenu.handleInput("\r");
    await settle();

    expect(selections).toEqual([]);
    // SAFETY: the component exposes its current notice for assertions.
    expect((submenu as any).notice).toContain("keychain locked");
  });
});
