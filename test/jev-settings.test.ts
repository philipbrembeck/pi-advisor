import { describe, expect, test } from "bun:test";

import { initTheme } from "@earendil-works/pi-coding-agent";

import { loadConfig } from "../src/config.ts";
import {
  advisorJevBaseUrlRef,
  advisorJevDigestMaxCharsRef,
  advisorJevFilterNoulMarginRef,
  advisorJevFilterOverrideWindowRef,
  advisorJevFilterSkipConfidenceRef,
  advisorJevKeyProviderRef,
  advisorJevModelRef,
  advisorJevPricePerMtokRef,
  advisorJevTimeoutMsRef,
  advisorJevTransportRef,
  advisorJevTurnGateEveryTurnsRef,
  advisorJevTurnGateNoulThresholdRef,
  setAdvisorJevBaseUrlRef,
  setAdvisorJevKeyProviderRef,
  setAdvisorJevModelRef,
  setAdvisorJevTimeoutMsRef,
  setAdvisorJevTransportRef,
} from "../src/config/state.ts";
import { saveConfig } from "../src/config/storage.ts";
import { validateConfig } from "../src/config/validation.ts";
import { AdvisorSettingsSelector } from "../src/ui.ts";
import type {
  AdvisorSettings,
  JevFilterSelection,
  JevProviderSelection,
  JevSetupDeps,
  JevSetupSelection,
} from "../src/ui/types.ts";
import {
  agentDir,
  savedConfig,
  withAgentDir,
} from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import type { JsonValue } from "./helpers/extension-context.ts";
import { changeSetting, plainScreen } from "./helpers/settings-navigation.ts";
import { plainThemeMock } from "./helpers/theme.ts";

initTheme();

const openSelector = (
  initial: any = {},
  options: {
    jevSetupDeps?: JevSetupDeps;
    onJevFilter?: (
      selection: JevFilterSelection,
      settings: AdvisorSettings
    ) => boolean;
    onJevProvider?: (
      selection: JevProviderSelection,
      settings: AdvisorSettings
    ) => boolean;
    onJevSetup?: (
      selection: JevSetupSelection,
      settings: AdvisorSettings
    ) => boolean;
  } = {}
) => {
  const saved: any[] = [];
  const selector = new AdvisorSettingsSelector({
    effortLevels: ["Default (Model Default)", "low", "high"],
    initial: {
      collapseResponses: false,
      completionGate: true,
      contextMaxChars: 15_000,
      effort: "Default (Model Default)",
      failureGate: true,
      planGate: true,
      ...initial,
    },
    jevSetupDeps: options.jevSetupDeps,
    onCancel: () => {},
    onChange: (value: any) => saved.push(value),
    onJevFilter: options.onJevFilter,
    onJevProvider: options.onJevProvider,
    onJevSetup: options.onJevSetup,
    presets: [
      { description: "none", label: "0", value: 0 },
      { description: "15k", label: "15k", value: 15_000 },
    ],
    theme: plainThemeMock,
    tui: { requestRender: () => undefined },
  });
  return { saved, selector };
};

const INVALID_SETTINGS: [Record<string, JsonValue>, RegExp][] = [
  [{ advisorJevTimeoutMs: 0 }, /advisorJevTimeoutMs/u],
  [{ advisorJevTimeoutMs: 1.5 }, /advisorJevTimeoutMs/u],
  [{ advisorJevDigestMaxChars: -1 }, /advisorJevDigestMaxChars/u],
  [{ advisorJevPricePerMtok: 0 }, /advisorJevPricePerMtok/u],
  [{ advisorJevTransport: "vercel" }, /advisorJevTransport/u],
  [{ advisorJevBaseUrl: "http://jev.example.com" }, /advisorJevBaseUrl/u],
  [{ advisorJevBaseUrl: "not a url" }, /advisorJevBaseUrl/u],
  [{ advisorJevBaseUrl: 42 }, /advisorJevBaseUrl/u],
  [{ advisorJevKeyProvider: "two words" }, /advisorJevKeyProvider/u],
  [{ advisorJevKeyProvider: 42 }, /advisorJevKeyProvider/u],
  [{ advisorJevFilterSkipConfidence: 0.4 }, /advisorJevFilterSkipConfidence/u],
  [{ advisorJevFilterSkipConfidence: 1.1 }, /advisorJevFilterSkipConfidence/u],
  [{ advisorJevFilterNoulMargin: -0.1 }, /advisorJevFilterNoulMargin/u],
  [{ advisorJevFilterNoulMargin: 0.6 }, /advisorJevFilterNoulMargin/u],
  [{ advisorJevFilterOverrideWindow: -1 }, /advisorJevFilterOverrideWindow/u],
  [{ advisorJevTurnGateEveryTurns: -1 }, /advisorJevTurnGateEveryTurns/u],
  [
    { advisorJevTurnGateNoulThreshold: 1.1 },
    /advisorJevTurnGateNoulThreshold/u,
  ],
];

const focusJevFilterRow = (selector: any) => {
  for (let presses = 0; presses < 60; presses += 1) {
    if (plainScreen(selector).includes("→ Jev/Decisions consultation filter")) {
      selector.handleInput("\r");
      return;
    }
    selector.handleInput("\u001B[B");
  }
  throw new Error("Jev/Decisions consultation filter row not reachable");
};

const focusJevProviderRow = (selector: any) => {
  for (let presses = 0; presses < 60; presses += 1) {
    if (plainScreen(selector).includes("→ Jev provider")) {
      selector.handleInput("\r");
      return;
    }
    selector.handleInput("\u001B[B");
  }
  throw new Error("Jev provider row not reachable");
};

const verifiedDeps = (): JevSetupDeps => ({
  resolveTransport: (transport) =>
    Promise.resolve({
      apiKey: "verified-key",
      transport: transport ?? "typesafe",
    }),
  verify: () => Promise.resolve({ ok: true }),
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Jev shared settings", () => {
  test("default to safe values and validate their types", async () => {
    await withAgentDir({}, () => {
      loadConfig(
        asExtensionContext({ cwd: "/", isProjectTrusted: () => false })
      );
      expect(advisorJevModelRef).toBe("jev-latest");
      expect(advisorJevTimeoutMsRef).toBe(8000);
      expect(advisorJevDigestMaxCharsRef).toBe(4000);
      expect(advisorJevPricePerMtokRef).toBe(0.042);
      expect(advisorJevTransportRef).toBe("auto");
      expect(advisorJevFilterSkipConfidenceRef).toBe(0.85);
      expect(advisorJevFilterNoulMarginRef).toBe(0.35);
      expect(advisorJevFilterOverrideWindowRef).toBe(10);
      expect(advisorJevTurnGateEveryTurnsRef).toBe(0);
      expect(advisorJevTurnGateNoulThresholdRef).toBe(0.8);
      expect(advisorJevBaseUrlRef).toBeUndefined();
      expect(advisorJevKeyProviderRef).toBeUndefined();
      expect(validateConfig({ advisorJevModel: "jev-1.13.0" })).toBe(true);
      expect(validateConfig({ advisorJevTimeoutMs: 5000 })).toBe(true);
      expect(validateConfig({ advisorJevDigestMaxChars: 0 })).toBe(true);
      expect(validateConfig({ advisorJevPricePerMtok: 0.042 })).toBe(true);
      expect(validateConfig({ advisorJevTransport: "openrouter" })).toBe(true);
      expect(validateConfig({ advisorJevTransport: "openai-decisions" })).toBe(
        true
      );
      expect(validateConfig({ advisorJevFilterSkipConfidence: 0.7 })).toBe(
        true
      );
      expect(validateConfig({ advisorJevFilterNoulMargin: 0.4 })).toBe(true);
      expect(validateConfig({ advisorJevFilterOverrideWindow: 5 })).toBe(true);
      expect(validateConfig({ advisorJevTurnGateEveryTurns: 5 })).toBe(true);
      expect(validateConfig({ advisorJevTurnGateNoulThreshold: 0.9 })).toBe(
        true
      );
      expect(
        validateConfig({ advisorJevTransport: "typesafe-compatible" })
      ).toBe(true);
      expect(
        validateConfig({ advisorJevBaseUrl: "https://api.codiv.ai/v1" })
      ).toBe(true);
      expect(
        validateConfig({ advisorJevBaseUrl: "http://localhost:11435" })
      ).toBe(true);
      expect(validateConfig({ advisorJevBaseUrl: "" })).toBe(true);
      expect(validateConfig({ advisorJevKeyProvider: "openrouter" })).toBe(
        true
      );
      expect(validateConfig({ advisorJevKeyProvider: "" })).toBe(true);
      for (const [invalid, pattern] of INVALID_SETTINGS) {
        expect(() => validateConfig(invalid)).toThrow(pattern);
      }
    });
  });

  test("loads and persists a System One–compatible endpoint", async () => {
    await withAgentDir(
      {
        advisorJevBaseUrl: "https://api.codiv.ai/v1",
        advisorJevKeyProvider: "openrouter",
        advisorJevTransport: "typesafe-compatible",
      },
      () => {
        const ctx = asExtensionContext({
          cwd: "/",
          isProjectTrusted: () => false,
        });
        loadConfig(ctx);
        expect(advisorJevBaseUrlRef).toBe("https://api.codiv.ai/v1");
        expect(advisorJevKeyProviderRef).toBe("openrouter");
        expect(advisorJevTransportRef).toBe("typesafe-compatible");
        setAdvisorJevBaseUrlRef("https://api.codiv.ai");
        setAdvisorJevKeyProviderRef("vercel");
        saveConfig(ctx);
        expect(savedConfig(agentDir())).toMatchObject({
          advisorJevBaseUrl: "https://api.codiv.ai",
          advisorJevKeyProvider: "vercel",
          advisorJevTransport: "typesafe-compatible",
        });
      }
    );
  });

  test("clearing the endpoint provider removes both fields without disturbing the rest", async () => {
    await withAgentDir(
      {
        advisorJevBaseUrl: "https://api.codiv.ai",
        advisorJevKeyProvider: "openrouter",
        advisorJevModel: "jev-1.13.0",
        advisorJevTransport: "typesafe-compatible",
      },
      () => {
        const ctx = asExtensionContext({
          cwd: "/",
          isProjectTrusted: () => false,
        });
        loadConfig(ctx);
        setAdvisorJevBaseUrlRef(undefined);
        setAdvisorJevKeyProviderRef(undefined);
        saveConfig(ctx);
        const saved = savedConfig(agentDir());
        expect(saved.advisorJevBaseUrl).toBeUndefined();
        expect(saved.advisorJevKeyProvider).toBeUndefined();
        expect(saved.advisorJevModel).toBe("jev-1.13.0");
        expect(saved.advisorJevTransport).toBe("typesafe-compatible");
      }
    );
  });

  test("loads and persists the OpenAI Decisions transport", async () => {
    await withAgentDir({ advisorJevTransport: "openai-decisions" }, () => {
      const ctx = asExtensionContext({
        cwd: "/",
        isProjectTrusted: () => false,
      });
      loadConfig(ctx);
      expect(advisorJevTransportRef).toBe("openai-decisions");
      setAdvisorJevTransportRef("openai-decisions");
      saveConfig(ctx);
      expect(savedConfig(agentDir()).advisorJevTransport).toBe(
        "openai-decisions"
      );
    });
  });

  test("apply and persist configured values", async () => {
    await withAgentDir(
      {
        advisorJevDigestMaxChars: 8000,
        advisorJevFilterEnabled: true,
        advisorJevFilterNoulMargin: 0.4,
        advisorJevFilterOverrideWindow: 20,
        advisorJevFilterSkipConfidence: 0.9,
        advisorJevModel: "jev-1.13.0",
        advisorJevPricePerMtok: 0.05,
        advisorJevTimeoutMs: 15_000,
        advisorJevTransport: "openrouter",
        advisorJevTurnGateEveryTurns: 5,
        advisorJevTurnGateNoulThreshold: 0.85,
      },
      () => {
        loadConfig(
          asExtensionContext({ cwd: "/", isProjectTrusted: () => false })
        );
        expect(advisorJevModelRef).toBe("jev-1.13.0");
        expect(advisorJevTimeoutMsRef).toBe(15_000);
        expect(advisorJevDigestMaxCharsRef).toBe(8000);
        expect(advisorJevPricePerMtokRef).toBe(0.05);
        expect(advisorJevTransportRef).toBe("openrouter");
        expect(advisorJevFilterSkipConfidenceRef).toBe(0.9);
        expect(advisorJevFilterNoulMarginRef).toBe(0.4);
        expect(advisorJevFilterOverrideWindowRef).toBe(20);
        expect(advisorJevTurnGateEveryTurnsRef).toBe(5);
        expect(advisorJevTurnGateNoulThresholdRef).toBe(0.85);

        setAdvisorJevModelRef(undefined);
        setAdvisorJevTimeoutMsRef(30_000);
        setAdvisorJevTransportRef("typesafe");
        saveConfig(
          asExtensionContext({ cwd: "/", isProjectTrusted: () => false })
        );
        expect(savedConfig(agentDir())).toEqual({
          advisorJevDigestMaxChars: 8000,
          advisorJevFilterEnabled: true,
          advisorJevFilterNoulMargin: 0.4,
          advisorJevFilterOverrideWindow: 20,
          advisorJevFilterSkipConfidence: 0.9,
          advisorJevModel: "jev-latest",
          advisorJevPricePerMtok: 0.05,
          advisorJevTimeoutMs: 30_000,
          advisorJevTransport: "typesafe",
          advisorJevTurnGateEveryTurns: 5,
          advisorJevTurnGateNoulThreshold: 0.85,
        });
      }
    );
  });

  test("preserve a hand-placed typesafe_api_key without warning on it", async () => {
    await withAgentDir(
      { typesafe_api_key: "tsk-config-key", unrelatedTypo: true },
      () => {
        loadConfig(
          asExtensionContext({ cwd: "/", isProjectTrusted: () => false })
        );
        const saved = savedConfig(agentDir());
        expect(saved.typesafe_api_key).toBe("tsk-config-key");
        expect("typesafe_api_key" in saved).toBe(true);
        // The reserved key never became a config setting.
        expect(saved).not.toHaveProperty("advisorJevFilterEnabled");
      }
    );
  });

  test("navigate and change the Jev rows", () => {
    const { saved, selector } = openSelector({
      jevDigestMaxChars: 4000,
      jevPricePerMtok: 0.042,
      jevTimeoutMs: 8000,
      jevTransport: "auto",
    });
    changeSetting(selector, "Jev timeout ms");
    expect(saved.at(-1)).toMatchObject({ jevTimeoutMs: 15_000 });
    changeSetting(selector, "Jev digest chars");
    expect(saved.at(-1)).toMatchObject({ jevDigestMaxChars: 8000 });
    changeSetting(selector, "Jev price/Mtok");
    expect(saved.at(-1)).toMatchObject({ jevPricePerMtok: 0.05 });
    changeSetting(selector, "Jev skip confidence");
    expect(saved.at(-1)).toMatchObject({ jevFilterSkipConfidence: 0.9 });
    changeSetting(selector, "Jev Noul margin");
    expect(saved.at(-1)).toMatchObject({ jevFilterNoulMargin: 0.4 });
    changeSetting(selector, "Jev override window");
    expect(saved.at(-1)).toMatchObject({ jevFilterOverrideWindow: 20 });
    changeSetting(selector, "Jev/Decisions turn gate");
    expect(saved.at(-1)).toMatchObject({ jevTurnGateEveryTurns: 3 });
    changeSetting(selector, "Jev/Decisions turn-gate threshold");
    expect(saved.at(-1)).toMatchObject({ jevTurnGateNoulThreshold: 0.85 });
    expect(plainScreen(selector)).not.toContain("Jev transport");
    selector.dispose();
  });

  test("the Jev provider row saves a verified provider and commits local state", async () => {
    const selections: JevProviderSelection[] = [];
    const candidates: AdvisorSettings[] = [];
    const { selector } = openSelector(
      { jevFilterEnabled: false, jevTransport: "auto" },
      {
        jevSetupDeps: verifiedDeps(),
        onJevProvider: (selection, settings) => {
          selections.push(selection);
          candidates.push(settings);
          return true;
        },
      }
    );
    focusJevProviderRow(selector);
    await settle();
    // SAFETY: the setup component is the submenu installed for the focused provider row.
    const submenu = (selector as any).settingsList.submenuComponent;
    submenu.handleInput("\r");
    await settle();

    expect(selections).toEqual([{ transport: "typesafe" }]);
    expect(candidates[0]).toMatchObject({ jevTransport: "typesafe" });
    // SAFETY: the selector's local settings are asserted through its runtime shape.
    expect((selector as any).settings).toMatchObject({
      jevTransport: "typesafe",
    });
    selector.dispose();
  });

  test("a failed provider save leaves the previous transport untouched", async () => {
    const { selector } = openSelector(
      { jevFilterEnabled: false, jevTransport: "auto" },
      { jevSetupDeps: verifiedDeps(), onJevProvider: () => false }
    );
    focusJevProviderRow(selector);
    await settle();
    // SAFETY: the setup component is the submenu installed for the focused provider row.
    const submenu = (selector as any).settingsList.submenuComponent;
    submenu.handleInput("\r");
    await settle();
    expect(plainScreen(selector)).toContain(
      "Provider verified, but settings could not be saved."
    );
    // SAFETY: the selector's local settings remain unchanged after a rejected save.
    expect((selector as any).settings).toMatchObject({ jevTransport: "auto" });
    selector.dispose();
  });

  test("the Jev filter row enables independently of the provider rows", async () => {
    const selections: JevFilterSelection[] = [];
    const { selector } = openSelector(
      { jevFilterEnabled: false, jevTransport: "typesafe" },
      {
        jevSetupDeps: verifiedDeps(),
        onJevFilter: (selection) => {
          selections.push(selection);
          return true;
        },
      }
    );
    focusJevFilterRow(selector);
    await settle();
    // SAFETY: the setup component is the submenu installed for the focused filter row.
    const submenu = (selector as any).settingsList.submenuComponent;
    expect(submenu?.constructor?.name).toBe("JevFilterSubmenu");
    submenu.handleInput("\r");
    await settle();
    expect(selections).toEqual([{ enabled: true }]);
    // SAFETY: the selector's local settings are asserted through its runtime shape.
    expect((selector as any).settings).toMatchObject({
      jevFilterEnabled: true,
    });
    selector.dispose();
  });

  test("the Jev filter row refuses to enable without a resolvable provider", async () => {
    const selections: JevFilterSelection[] = [];
    const { selector } = openSelector(
      { jevFilterEnabled: false, jevTransport: "auto" },
      {
        jevSetupDeps: {
          resolveTransport: () => Promise.resolve(undefined),
          verify: () => Promise.resolve({ ok: true }),
        },
        onJevFilter: (selection) => {
          selections.push(selection);
          return true;
        },
      }
    );
    focusJevFilterRow(selector);
    await settle();
    // SAFETY: the setup component is the submenu installed for the focused filter row.
    const submenu = (selector as any).settingsList.submenuComponent;
    submenu.handleInput("\r");
    await settle();
    expect(selections).toEqual([]);
    expect(plainScreen(selector)).toContain("No Jev provider resolves");
    selector.dispose();
  });

  test("a failed filter save surfaces a notice and keeps the filter off", async () => {
    const { selector } = openSelector(
      { jevFilterEnabled: false, jevTransport: "typesafe" },
      { jevSetupDeps: verifiedDeps(), onJevFilter: () => false }
    );
    focusJevFilterRow(selector);
    await settle();
    // SAFETY: the setup component is the submenu installed for the focused filter row.
    const submenu = (selector as any).settingsList.submenuComponent;
    submenu.handleInput("\r");
    await settle();
    expect(plainScreen(selector)).toContain(
      "The filter state could not be saved."
    );
    // SAFETY: the selector's local settings remain unchanged after a rejected save.
    expect((selector as any).settings).toMatchObject({
      jevFilterEnabled: false,
    });
    selector.dispose();
  });

  test("the deprecated onJevSetup callback still receives the provider row", async () => {
    const selections: JevSetupSelection[] = [];
    const { selector } = openSelector(
      { jevFilterEnabled: false, jevTransport: "auto" },
      {
        jevSetupDeps: verifiedDeps(),
        onJevSetup: (selection) => {
          selections.push(selection);
          return true;
        },
      }
    );
    focusJevProviderRow(selector);
    await settle();
    // SAFETY: the setup component is the submenu installed for the focused provider row.
    const submenu = (selector as any).settingsList.submenuComponent;
    submenu.handleInput("\r");
    await settle();
    expect(selections).toEqual([{ enabled: false, transport: "typesafe" }]);
    selector.dispose();
  });

  test("the Jev model submenu applies a trimmed custom model", () => {
    const { saved, selector } = openSelector();
    const presses = (() => {
      for (let i = 0; i < 60; i += 1) {
        if (plainScreen(selector).includes("→ Jev model")) {
          return i;
        }
        selector.handleInput("\u001B[B");
      }
      throw new Error("Jev model row not reachable");
    })();
    expect(presses).toBeGreaterThanOrEqual(0);
    selector.handleInput("\r");
    // SAFETY: settingsList.submenuComponent is the live submenu the selector installed on open.
    const editor = (selector as any).settingsList.submenuComponent;
    editor.input.setValue("  jev-1.13.0 \n");
    editor.input.onSubmit(editor.input.getValue());
    expect(saved.at(-1)).toMatchObject({ jevModel: "jev-1.13.0" });
    selector.dispose();
  });
});
