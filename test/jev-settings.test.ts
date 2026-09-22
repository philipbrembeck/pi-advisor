import { describe, expect, test } from "bun:test";

import { initTheme } from "@earendil-works/pi-coding-agent";

import { loadConfig } from "../src/config.ts";
import {
  advisorJevDigestMaxCharsRef,
  advisorJevFilterNoulMarginRef,
  advisorJevFilterOverrideWindowRef,
  advisorJevFilterSkipConfidenceRef,
  advisorJevModelRef,
  advisorJevPricePerMtokRef,
  advisorJevTimeoutMsRef,
  advisorJevTransportRef,
  advisorJevTurnGateEveryTurnsRef,
  advisorJevTurnGateNoulThresholdRef,
  setAdvisorJevModelRef,
  setAdvisorJevTimeoutMsRef,
  setAdvisorJevTransportRef,
} from "../src/config/state.ts";
import { saveConfig } from "../src/config/storage.ts";
import { validateConfig } from "../src/config/validation.ts";
import { AdvisorSettingsSelector } from "../src/ui.ts";
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

const openSelector = (initial: any = {}) => {
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
    onCancel: () => {},
    onChange: (value: any) => saved.push(value),
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
    if (plainScreen(selector).includes("→ Jev consultation filter")) {
      selector.handleInput("\r");
      return;
    }
    selector.handleInput("\u001B[B");
  }
  throw new Error("Jev consultation filter row not reachable");
};

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
      expect(validateConfig({ advisorJevModel: "jev-1.13.0" })).toBe(true);
      expect(validateConfig({ advisorJevTimeoutMs: 5000 })).toBe(true);
      expect(validateConfig({ advisorJevDigestMaxChars: 0 })).toBe(true);
      expect(validateConfig({ advisorJevPricePerMtok: 0.042 })).toBe(true);
      expect(validateConfig({ advisorJevTransport: "openrouter" })).toBe(true);
      expect(validateConfig({ advisorJevFilterSkipConfidence: 0.7 })).toBe(
        true
      );
      expect(validateConfig({ advisorJevFilterNoulMargin: 0.4 })).toBe(true);
      expect(validateConfig({ advisorJevFilterOverrideWindow: 5 })).toBe(true);
      expect(validateConfig({ advisorJevTurnGateEveryTurns: 5 })).toBe(true);
      expect(validateConfig({ advisorJevTurnGateNoulThreshold: 0.9 })).toBe(
        true
      );
      for (const [invalid, pattern] of INVALID_SETTINGS) {
        expect(() => validateConfig(invalid)).toThrow(pattern);
      }
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
    changeSetting(selector, "Jev turn gate");
    expect(saved.at(-1)).toMatchObject({ jevTurnGateEveryTurns: 3 });
    changeSetting(selector, "Jev turn-gate threshold");
    expect(saved.at(-1)).toMatchObject({ jevTurnGateNoulThreshold: 0.85 });
    changeSetting(selector, "Jev transport");
    expect(saved.at(-1)).toMatchObject({ jevTransport: "typesafe" });
    expect(plainScreen(selector)).toContain("typesafe");
    selector.dispose();
  });

  test("the Jev consultation filter row opens the guided setup submenu", () => {
    const { saved, selector } = openSelector();
    const screenText = plainScreen(selector);
    expect(screenText).not.toContain("Jev consultation filter");
    focusJevFilterRow(selector);
    // SAFETY: settingsList.submenuComponent is the live submenu the selector installed on open.
    const submenu = (selector as any).settingsList.submenuComponent;
    expect(submenu?.constructor?.name).toBe("JevSetupSubmenu");
    submenu.options.done("On");
    expect(saved.at(-1)).toMatchObject({ jevFilterEnabled: true });
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
