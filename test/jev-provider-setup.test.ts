import { describe, expect, test } from "bun:test";

import { JevProviderSubmenu } from "../src/ui/jev-provider-submenu.ts";
import type { JevProviderSelection, JevSetupDeps } from "../src/ui/types.ts";
import { plainThemeMock } from "./helpers/theme.ts";

const DOWN = "\u001B[B";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const open = (
  options: {
    currentBaseUrl?: string;
    currentKeyProvider?: string;
    currentTransport?: "auto" | "typesafe-compatible";
    deps?: JevSetupDeps;
    onSelection?: (selection: JevProviderSelection) => boolean;
  } = {}
) => {
  const selections: JevProviderSelection[] = [];
  const submenu = new JevProviderSubmenu(
    {
      currentBaseUrl: options.currentBaseUrl,
      currentKeyProvider: options.currentKeyProvider,
      currentTransport: options.currentTransport ?? "auto",
      currentValue: "provider",
      done: () => undefined,
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
  return { selections, submenu };
};

const menuEntries = (submenu: JevProviderSubmenu): string[] => {
  const lines = submenu.render(200);
  const entries: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (!(line.startsWith("→ ") || line.startsWith("  "))) {
      break;
    }
    entries.unshift(line.replace(/^(?:→ | {2})/u, "").trimEnd());
  }
  return entries;
};

const chooseAction = async (
  submenu: JevProviderSubmenu,
  label: string
): Promise<void> => {
  const entries = menuEntries(submenu);
  const index = entries.indexOf(label);
  if (index === -1) {
    throw new Error(`menu entry ${label} not found in ${entries.join(" | ")}`);
  }
  for (let step = 0; step < index; step += 1) {
    submenu.handleInput(DOWN);
  }
  submenu.handleInput("\r");
  await settle();
};

const CUSTOM = "System One–compatible endpoint…";
const REUSE = "Reuse a Pi provider login";
const CLEAR = "Clear stored key";

const typeText = async (
  submenu: JevProviderSubmenu,
  value: string
): Promise<void> => {
  // SAFETY: the base URL and provider id steps both render the component's text input.
  const input = (submenu as any).textInput;
  input.setValue(value);
  submenu.handleInput("\r");
  await settle();
  await settle();
};

const typeKey = async (
  submenu: JevProviderSubmenu,
  value: string
): Promise<void> => {
  // SAFETY: the key step renders the component's masked input.
  const input = (submenu as any).maskedInput;
  input.setValue(value);
  submenu.handleInput("\r");
  await settle();
  await settle();
};

const baseDeps = (overrides: Partial<JevSetupDeps>): JevSetupDeps => ({
  resolveEndpoint: () => Promise.resolve(undefined),
  resolveTransport: () => Promise.resolve(undefined),
  verify: () => Promise.resolve({ ok: true }),
  writeKey: () => Promise.resolve({ message: "stored", ok: true }),
  ...overrides,
});

describe("JevProviderSubmenu custom endpoint", () => {
  test("a valid Base URL with an existing key verifies and saves the endpoint", async () => {
    const lookups: unknown[] = [];
    const { selections, submenu } = open({
      deps: baseDeps({
        resolveEndpoint: (options) => {
          lookups.push(options);
          return Promise.resolve({
            apiKey: "jv_live_key",
            baseUrl: options.baseUrl,
            source: "jev-env",
            transport: "typesafe-compatible",
          });
        },
      }),
    });
    await settle();
    await chooseAction(submenu, CUSTOM);
    await typeText(submenu, "https://gw.corp/llm/jev/v1");

    expect(lookups).toEqual([{ baseUrl: "https://gw.corp/llm/jev" }]);
    expect(selections).toEqual([
      { baseUrl: "https://gw.corp/llm/jev", transport: "typesafe-compatible" },
    ]);
  });

  test("an unusable Base URL is refused before any resolution", async () => {
    const { selections, submenu } = open({
      deps: baseDeps({
        resolveEndpoint: () => {
          throw new Error("must not resolve an unusable Base URL");
        },
      }),
    });
    await settle();
    await chooseAction(submenu, CUSTOM);
    await typeText(submenu, "http://jev.example.com");

    expect(selections).toEqual([]);
    // SAFETY: the component exposes its active mode for assertions.
    expect((submenu as any).mode).toBe("base-url");
    // SAFETY: the rejected value surfaces as an inline error, not a notice.
    expect((submenu as any).inputError).toBeString();
  });

  test("an entered key is stored and clears a reused Pi login", async () => {
    const written: [string, string][] = [];
    const { selections, submenu } = open({
      currentKeyProvider: "openrouter",
      deps: baseDeps({
        resolveEndpoint: () => Promise.resolve(undefined),
        writeKey: (key, transport) => {
          written.push([key, transport]);
          return Promise.resolve({ message: "stored", ok: true });
        },
      }),
    });
    await settle();
    await chooseAction(submenu, CUSTOM);
    await typeText(submenu, "https://api.codiv.ai");
    // No stored key resolves, so the flow moves straight to key entry.
    await typeKey(submenu, "jv_live_key");

    expect(written).toEqual([["jv_live_key", "typesafe-compatible"]]);
    expect(selections).toEqual([
      { baseUrl: "https://api.codiv.ai", transport: "typesafe-compatible" },
    ]);
  });

  test("reusing a Pi provider login records the provider id", async () => {
    const { selections, submenu } = open({
      currentBaseUrl: "https://api.codiv.ai",
      deps: baseDeps({
        resolveEndpoint: (options) =>
          Promise.resolve(
            options.keyProvider
              ? {
                  apiKey: "pi-stored-key",
                  baseUrl: options.baseUrl,
                  source: "provider-credential" as const,
                  transport: "typesafe-compatible" as const,
                }
              : undefined
          ),
      }),
    });
    await settle();
    await chooseAction(submenu, REUSE);
    await typeText(submenu, "openrouter");

    expect(selections).toEqual([
      {
        baseUrl: "https://api.codiv.ai",
        keyProvider: "openrouter",
        transport: "typesafe-compatible",
      },
    ]);
  });

  test("an unknown Pi provider id is reported without saving", async () => {
    const { selections, submenu } = open({
      currentBaseUrl: "https://api.codiv.ai",
      deps: baseDeps({ resolveEndpoint: () => Promise.resolve(undefined) }),
    });
    await settle();
    await chooseAction(submenu, REUSE);
    await typeText(submenu, "nope");

    expect(selections).toEqual([]);
    // SAFETY: the component exposes its current notice for assertions.
    expect((submenu as any).notice).toContain("nope");
  });

  test("a failed verification saves nothing and keeps the previous transport", async () => {
    const { selections, submenu } = open({
      deps: baseDeps({
        resolveEndpoint: (options) =>
          Promise.resolve({
            apiKey: "jv_live_key",
            baseUrl: options.baseUrl,
            source: "jev-env",
            transport: "typesafe-compatible",
          }),
        verify: () => Promise.resolve({ message: "HTTP 401", ok: false }),
      }),
    });
    await settle();
    await chooseAction(submenu, CUSTOM);
    await typeText(submenu, "https://api.codiv.ai");

    expect(selections).toEqual([]);
    // SAFETY: the component exposes its current notice for assertions.
    expect((submenu as any).notice).toContain("Verification failed");
  });

  test("a rejected save reports that the provider was verified but not stored", async () => {
    const { submenu } = open({
      deps: baseDeps({
        resolveEndpoint: (options) =>
          Promise.resolve({
            apiKey: "jv_live_key",
            baseUrl: options.baseUrl,
            source: "jev-env",
            transport: "typesafe-compatible",
          }),
      }),
      onSelection: () => false,
    });
    await settle();
    await chooseAction(submenu, CUSTOM);
    await typeText(submenu, "https://api.codiv.ai");

    // SAFETY: the component exposes its current notice for assertions.
    expect((submenu as any).notice).toBe(
      "Provider verified, but settings could not be saved."
    );
  });

  test("clearing the stored endpoint key targets the endpoint store", async () => {
    const cleared: string[] = [];
    const { submenu } = open({
      currentTransport: "typesafe-compatible",
      deps: baseDeps({
        clearStoredKey: (transport) => {
          cleared.push(transport);
          return Promise.resolve({ message: "cleared", ok: true });
        },
        resolveTransport: (transport) =>
          Promise.resolve({
            apiKey: "jv_live_key",
            baseUrl: "https://api.codiv.ai",
            source: "jev-bun-secrets",
            transport: transport ?? "typesafe",
          }),
      }),
    });
    await settle();
    await chooseAction(submenu, CLEAR);

    expect(cleared).toEqual(["typesafe-compatible"]);
  });
});
