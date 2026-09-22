import { afterEach, describe, expect, test } from "bun:test";

import {
  setAdvisorJevFilterEnabledRef,
  setAdvisorJevTransportRef,
} from "../src/config/state.ts";
import { resetPlaintextKeyWarning } from "../src/jev/key-store.ts";
import type { JevCredentials, JevTransportKind } from "../src/jev/transport.ts";
import type { JevSetupDeps } from "../src/ui/jev-setup-submenu.ts";
import { JevSetupSubmenu } from "../src/ui/jev-setup-submenu.ts";
import { MaskedInput } from "../src/ui/masked-input.ts";
import { plainThemeMock } from "./helpers/theme.ts";

const credentials = (
  transport: JevTransportKind,
  source?: JevCredentials["source"]
): JevCredentials => {
  const value: JevCredentials = { apiKey: "tsk-live-key", transport };
  if (source) {
    value.source = source;
  }
  return value;
};

/** Deps tests inject; hasSecretStore rides along unused by the submenu. */
type SetupDepsFixture = JevSetupDeps & { hasSecretStore?: () => boolean };

const openSetup = (
  options: { currentValue?: string; deps?: SetupDepsFixture } = {}
) => {
  const results: (string | undefined)[] = [];
  const renders: string[] = [];
  const setup = new JevSetupSubmenu(
    {
      currentValue: options.currentValue ?? "Off",
      done: (value) => results.push(value),
      theme: plainThemeMock,
      tui: { requestRender: () => renders.push("render") },
    },
    {
      resolveTransport: () => Promise.resolve(undefined),
      verify: () => Promise.resolve({ ok: true }),
      ...options.deps,
    }
  );
  return { renders, results, setup };
};

const screen = (setup: JevSetupSubmenu) => setup.render(100).join("\n");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  setAdvisorJevFilterEnabledRef(false);
  setAdvisorJevTransportRef("auto");
  resetPlaintextKeyWarning();
});

describe("JevSetupSubmenu", () => {
  test("resolves and labels an OpenRouter login reuse", async () => {
    const { setup } = openSetup({
      deps: {
        resolveTransport: () => Promise.resolve(credentials("openrouter")),
      },
    });
    await settle();
    expect(screen(setup)).toContain("OpenRouter (reusing pi login)");
    expect(screen(setup)).toContain("Verify and enable");
  });

  test("labels the plaintext advisor.json source as not recommended", async () => {
    const { setup } = openSetup({
      deps: {
        resolveTransport: () =>
          Promise.resolve(credentials("typesafe", "advisor-json")),
      },
    });
    await settle();
    expect(screen(setup)).toContain("plaintext, not recommended");
    expect(screen(setup)).toContain("typesafe_api_key");
    resetPlaintextKeyWarning();
    const second = openSetup({
      deps: {
        resolveTransport: () =>
          Promise.resolve(credentials("typesafe", "advisor-json")),
      },
    });
    await settle();
    expect(screen(second.setup)).toContain("plaintext, not recommended");
  });

  test("enables only after a successful live verification", async () => {
    let verified = 0;
    const { results, setup } = openSetup({
      deps: {
        resolveTransport: () => Promise.resolve(credentials("openrouter")),
        verify: () => {
          verified += 1;
          return Promise.resolve({
            message: "Jev authentication failed: 401",
            ok: false,
          });
        },
      },
    });
    await settle();
    setup.handleInput("\r");
    await settle();
    expect(verified).toBe(1);
    expect(results).toEqual([]);
    expect(screen(setup)).toContain("Verification failed");
    expect(screen(setup)).toContain("Jev authentication failed: 401");
  });

  test("flips the flag on when verification succeeds", async () => {
    const { results, setup } = openSetup({
      deps: {
        resolveTransport: () => Promise.resolve(credentials("openrouter")),
      },
    });
    await settle();
    setup.handleInput("\r");
    await settle();
    expect(results).toEqual(["On"]);
  });

  test("stores an entered key in Bun.secrets after verifying", async () => {
    const written: string[] = [];
    const { results, setup } = openSetup({
      deps: {
        hasSecretStore: () => true,
        writeKey: (key: string) => {
          written.push(key);
          return Promise.resolve({ message: "stored", ok: true });
        },
      },
    });
    await settle();
    setup.handleInput("\r");
    expect(screen(setup)).toContain("Paste a TypeSafe API key");
    for (const key of ["t", "s", "k", "-", "9"]) {
      setup.handleInput(key);
    }
    setup.handleInput("\r");
    await settle();
    expect(written).toEqual(["tsk-9"]);
    expect(results).toEqual(["On"]);
  });

  test("masks the entered key on screen", () => {
    const masked = new MaskedInput({});
    for (const key of ["t", "s", "k"]) {
      masked.handleInput(key);
    }
    expect(masked.render(40)[0]).toBe("•••█");
    expect(masked.render(40)[0]).not.toContain("tsk");
    expect(masked.getValue()).toBe("tsk");
  });

  test("stores the entered key securely even without Bun.secrets and enables", async () => {
    const written: string[] = [];
    const { results, setup } = openSetup({
      deps: {
        writeKey: (key: string) => {
          written.push(key);
          return Promise.resolve({
            message: "Key stored in ~/.pi/agent/typesafe_api_key (mode 0600).",
            ok: true,
          });
        },
      },
    });
    await settle();
    setup.handleInput("\r");
    setup.handleInput("t");
    setup.handleInput("s");
    setup.handleInput("k");
    setup.handleInput("\r");
    await settle();
    expect(written).toEqual(["tsk"]);
    expect(results).toEqual(["On"]);
    const screenText = screen(setup);
    expect(screenText).toContain("mode 0600");
    expect(screenText).not.toContain("tsk");
  });

  test("a store failure surfaces the env alternative without enabling", async () => {
    const { results, setup } = openSetup({
      deps: {
        hasSecretStore: () => true,
        writeKey: () =>
          Promise.resolve({
            message:
              "Storing the key in Bun.secrets failed: denied. Alternatively set the TYPESAFE_API_KEY environment variable in your shell profile.",
            ok: false,
          }),
      },
    });
    await settle();
    setup.handleInput("\r");
    setup.handleInput("t");
    setup.handleInput("\r");
    await settle();
    expect(screen(setup)).toContain("TYPESAFE_API_KEY");
    expect(results).toEqual([]);
  });

  test("disable keeps the key; disable-and-clear clears the stored secret", async () => {
    let cleared = 0;
    const { results, setup } = openSetup({
      currentValue: "On",
      deps: {
        clearStoredKey: () => {
          cleared += 1;
          return Promise.resolve({ message: "Stored key cleared.", ok: true });
        },
        resolveTransport: () =>
          Promise.resolve(credentials("typesafe", "bun-secrets")),
      },
    });
    await settle();
    expect(screen(setup)).toContain("Disable and clear stored key");
    // Index 1 is plain Disable: it keeps the stored key.
    setup.handleInput("\u001B[B");
    setup.handleInput("\r");
    await settle();
    expect(results).toEqual(["Off"]);
    expect(cleared).toBe(0);
    // Reopen and pick Disable and clear stored key (index 2).
    const second = openSetup({
      currentValue: "On",
      deps: {
        clearStoredKey: () => {
          cleared += 1;
          return Promise.resolve({ message: "Stored key cleared.", ok: true });
        },
        resolveTransport: () =>
          Promise.resolve(credentials("typesafe", "bun-secrets")),
      },
    });
    await settle();
    second.setup.handleInput("\u001B[B");
    second.setup.handleInput("\u001B[B");
    second.setup.handleInput("\r");
    await settle();
    expect(second.results).toEqual(["Off"]);
    expect(cleared).toBe(1);
  });

  test("migrates a plaintext advisor.json key into Bun.secrets on enable", async () => {
    const written: string[] = [];
    let removedPlaintext = false;
    const { results, setup } = openSetup({
      deps: {
        hasSecretStore: () => true,
        removePlaintextKey: () => {
          removedPlaintext = true;
          return {
            message: "Plaintext key removed from advisor.json.",
            ok: true,
          };
        },
        resolveTransport: () =>
          Promise.resolve(credentials("typesafe", "advisor-json")),
        writeKey: (key: string) => {
          written.push(key);
          return Promise.resolve({ message: "stored", ok: true });
        },
      },
    });
    await settle();
    setup.handleInput("\r");
    await settle();
    expect(written).toEqual(["tsk-live-key"]);
    expect(removedPlaintext).toBe(true);
    expect(results).toEqual(["On"]);
  });

  test("shows the OpenRouter fallback hint when nothing resolves", async () => {
    const { setup } = openSetup();
    await settle();
    const text = screen(setup);
    expect(text).toContain("No Jev credentials found");
    expect(text).toContain("OpenRouter login");
  });
});
