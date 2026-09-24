import { describe, expect, test } from "bun:test";

import { initTheme } from "@earendil-works/pi-coding-agent";

import { saveAdvisorSettings } from "../src/commands/settings-persistence.ts";
import { loadConfig, resetConfigCache } from "../src/config.ts";
import {
  advisorScoutTimeoutMsRef,
  setAdvisorScoutTimeoutMsRef,
} from "../src/config/state.ts";
import {
  DEFAULT_SCOUT_TIMEOUT_MS,
  MAX_SCOUT_TIMEOUT_MS,
} from "../src/config/types.ts";
import { validateConfig } from "../src/config/validation.ts";
import { AdvisorSettingsSelector } from "../src/ui.ts";
import type { AdvisorSettings } from "../src/ui/types.ts";
import {
  agentDir,
  savedConfig,
  withAgentDir,
} from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { changeSetting, plainScreen } from "./helpers/settings-navigation.ts";
import { plainThemeMock } from "./helpers/theme.ts";

initTheme();

const extensionContext = () =>
  asExtensionContext({ cwd: "/", isProjectTrusted: () => false });

const initialSettings = (scoutTimeoutMs: number): AdvisorSettings => ({
  collapseResponses: false,
  completionGate: true,
  contextMaxChars: 15_000,
  failureGate: true,
  planGate: true,
  scoutTimeoutMs,
});

describe("Advisor Scout timeout setting", () => {
  test("defaults to 30 seconds and rejects invalid values", async () => {
    await withAgentDir({}, () => {
      loadConfig(extensionContext());
      expect(DEFAULT_SCOUT_TIMEOUT_MS).toBe(30_000);
      expect(advisorScoutTimeoutMsRef).toBe(30_000);
      expect(validateConfig({ advisorScoutTimeoutMs: 1 })).toBe(true);
      expect(
        validateConfig({ advisorScoutTimeoutMs: MAX_SCOUT_TIMEOUT_MS })
      ).toBe(true);
      for (const value of [0, -1, 1.5, MAX_SCOUT_TIMEOUT_MS + 1]) {
        expect(() => validateConfig({ advisorScoutTimeoutMs: value })).toThrow(
          /advisorScoutTimeoutMs/u
        );
      }
    });
  });

  test("loads, changes, persists, and reloads the settings value", async () => {
    await withAgentDir({ advisorScoutTimeoutMs: 45_000 }, async () => {
      const ctx = extensionContext();
      loadConfig(ctx);
      expect(advisorScoutTimeoutMsRef).toBe(45_000);

      const updates: AdvisorSettings[] = [];
      const selector = new AdvisorSettingsSelector({
        effortLevels: ["Default (Model Default)", "high"],
        initial: initialSettings(advisorScoutTimeoutMsRef),
        onCancel: () => {},
        onChange: (settings) => updates.push(settings),
        presets: [{ description: "Recent", label: "15k", value: 15_000 }],
        theme: plainThemeMock,
        tui: { requestRender: () => {} },
      });
      try {
        const screen = plainScreen(selector);
        expect(screen).toContain("Scout timeout ms");
        expect(screen).toContain("45000");
        changeSetting(selector, "Scout timeout ms");
        const updated = updates.at(-1);
        expect(updated?.scoutTimeoutMs).toBe(60_000);
        if (!updated) {
          throw new Error("Scout timeout setting was not saved");
        }
        saveAdvisorSettings(ctx, updated);
        expect(savedConfig(agentDir()).advisorScoutTimeoutMs).toBe(60_000);
        resetConfigCache();
        loadConfig(ctx);
        expect(advisorScoutTimeoutMsRef).toBe(60_000);
      } finally {
        selector.dispose();
        setAdvisorScoutTimeoutMsRef(DEFAULT_SCOUT_TIMEOUT_MS);
      }
    });
  });
});
