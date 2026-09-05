import { describe, expect, test } from "bun:test";
import {
  contextMaxCharsRef as leafContextMaxCharsRef,
  setContextMaxCharsRef as leafSetContextMaxCharsRef,
} from "../src/config/state.js";
import { loadConfig as leafLoadConfig } from "../src/config/storage.js";
import { DEFAULT_CONTEXT_MAX_CHARS as leafDefaultContextMaxChars } from "../src/config/types.js";
import { validateConfig as leafValidateConfig } from "../src/config/validation.js";
import type {
  AdvisorConfig,
  AdvisorToolPolicies,
  AdvisorToolPolicy,
  GateFailureMode,
  SaveConfigOptions,
} from "../src/config.js";
import {
  contextMaxCharsRef as facadeContextMaxCharsRef,
  DEFAULT_CONTEXT_MAX_CHARS as facadeDefaultContextMaxChars,
  loadConfig as facadeLoadConfig,
  setContextMaxCharsRef as facadeSetContextMaxCharsRef,
  validateConfig as facadeValidateConfig,
} from "../src/config.js";
import { ManualAdvisorDialog as leafManualAdvisorDialog } from "../src/ui/manual-dialog.js";
import { SearchableModelSelector as leafSearchableModelSelector } from "../src/ui/model-selector.js";
import { AdvisorSettingsSelector as leafAdvisorSettingsSelector } from "../src/ui/settings-selector.js";
import type {
  AdvisorSettings,
  ContextPreset,
  ManualAdvisorRequest,
} from "../src/ui.js";
import {
  AdvisorSettingsSelector as facadeAdvisorSettingsSelector,
  ManualAdvisorDialog as facadeManualAdvisorDialog,
  SearchableModelSelector as facadeSearchableModelSelector,
} from "../src/ui.js";

export interface ConfigFacadeTypeInventory {
  config: AdvisorConfig;
  mode: GateFailureMode;
  options: SaveConfigOptions;
  policies: AdvisorToolPolicies;
  policy: AdvisorToolPolicy;
}

export interface UiFacadeTypeInventory {
  context: ContextPreset;
  request: ManualAdvisorRequest;
  settings: AdvisorSettings;
}

describe("config compatibility facade", () => {
  test("re-exports values from their owning leaf modules", () => {
    expect(facadeDefaultContextMaxChars).toBe(leafDefaultContextMaxChars);
    expect(facadeContextMaxCharsRef).toBe(leafContextMaxCharsRef);
    expect(facadeSetContextMaxCharsRef).toBe(leafSetContextMaxCharsRef);
    expect(facadeValidateConfig).toBe(leafValidateConfig);
    expect(facadeLoadConfig).toBe(leafLoadConfig);
  });

  test("re-exports UI constructors from their owning leaf modules", () => {
    expect(facadeManualAdvisorDialog).toBe(leafManualAdvisorDialog);
    expect(facadeSearchableModelSelector).toBe(leafSearchableModelSelector);
    expect(facadeAdvisorSettingsSelector).toBe(leafAdvisorSettingsSelector);
  });

  test("keeps facade and direct state imports live after setter mutation", () => {
    const previous = facadeContextMaxCharsRef;
    const next = previous === 0 ? 1 : 0;
    try {
      facadeSetContextMaxCharsRef(next);
      expect(facadeContextMaxCharsRef).toBe(next);
      expect(leafContextMaxCharsRef).toBe(next);
      leafSetContextMaxCharsRef(previous);
      expect(facadeContextMaxCharsRef).toBe(previous);
      expect(leafContextMaxCharsRef).toBe(previous);
    } finally {
      facadeSetContextMaxCharsRef(previous);
    }
  });
});
