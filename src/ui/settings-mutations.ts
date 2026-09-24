import { DEFAULT_JEV_MODEL } from "../config/types.ts";
import type { AdvisorSettings, ContextPreset } from "./types.ts";

const BOOLEAN_SETTING_FIELDS = [
  "autoLoopGate",
  "blockOnBlocked",
  "collapseResponses",
  "completionGate",
  "failureGate",
  "herdrIntegration",
  "outcomeLogging",
  "planGate",
  "redactSecrets",
  "scoutEnabled",
  "sessionSummary",
  "showUsageDetails",
  "showUsageFooter",
  "trackedFileContent",
  "untrackedContent",
] as const;

const BOOLEAN_SETTING_IDS = new Set<string>(BOOLEAN_SETTING_FIELDS);

type BooleanSettingField = (typeof BOOLEAN_SETTING_FIELDS)[number];

const parseModelWhitelist = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean)
  ),
];

const applyCoreMutation = (
  settings: AdvisorSettings,
  id: string,
  value: string,
  presets: ContextPreset[]
): boolean => {
  switch (id) {
    case "context": {
      settings.contextMaxChars =
        presets.find((preset) => preset.label === value)?.value ??
        settings.contextMaxChars;
      return true;
    }
    case "simpleMode": {
      settings.simpleMode = value === "On";
      return true;
    }
    case "alwaysOn": {
      settings.alwaysOn = value === "On";
      return true;
    }
    case "effort": {
      settings.effort = value;
      return true;
    }
    case "customRule": {
      settings.customRule = value.trim() || undefined;
      return true;
    }
    case "toolPolicies": {
      // SAFETY: the value originates from the settings submenu's previously validated JSON editor.
      settings.toolPolicies = JSON.parse(
        value
      ) as AdvisorSettings["toolPolicies"];
      return true;
    }
    case "loopThreshold": {
      settings.loopThreshold = Number(
        value.replace("After ", "").replace(" repeats", "")
      );
      return true;
    }
    case "maxCallsPerSession": {
      settings.maxCallsPerSession = value === "∞" ? undefined : Number(value);
      return true;
    }
    case "modelWhitelist": {
      settings.modelWhitelist = parseModelWhitelist(value);
      return true;
    }
    case "failureMode": {
      // SAFETY: value comes from the fixed failureMode options of the settings list.
      settings.failureMode = value as AdvisorSettings["failureMode"];
      return true;
    }
    case "gitContext": {
      // SAFETY: value comes from the fixed GitContextLevel options of the settings list.
      settings.gitContext = value as AdvisorSettings["gitContext"];
      return true;
    }
    default: {
      return false;
    }
  }
};

const applyNumericMutation = (
  settings: AdvisorSettings,
  id: string,
  value: string
): boolean => {
  switch (id) {
    case "toolResultMaxLines": {
      settings.toolResultMaxLines = Number(value);
      return true;
    }
    case "toolResultMaxBytes": {
      settings.toolResultMaxBytes = Number(value);
      return true;
    }
    case "gitContextMaxChars": {
      settings.gitContextMaxChars = Number(value);
      return true;
    }
    default: {
      return false;
    }
  }
};

const applyJevMutation = (
  settings: AdvisorSettings,
  id: string,
  value: string
): boolean => {
  switch (id) {
    case "jevFilter": {
      settings.jevFilterEnabled = value === "On";
      return true;
    }
    case "jevFilterSkipConfidence": {
      settings.jevFilterSkipConfidence = Number(value);
      return true;
    }
    case "jevFilterNoulMargin": {
      settings.jevFilterNoulMargin = Number(value);
      return true;
    }
    case "jevFilterOverrideWindow": {
      settings.jevFilterOverrideWindow = Number(value.replace(" turns", ""));
      return true;
    }
    case "jevTurnGateEveryTurns": {
      settings.jevTurnGateEveryTurns =
        value === "Off" ? 0 : Number(value.replaceAll(/[^0-9]/gu, ""));
      return true;
    }
    case "jevTurnGateNoulThreshold": {
      settings.jevTurnGateNoulThreshold = Number(value);
      return true;
    }
    case "jevModel": {
      settings.jevModel = value.trim() || DEFAULT_JEV_MODEL;
      return true;
    }
    case "jevTimeoutMs": {
      settings.jevTimeoutMs = Number(value);
      return true;
    }
    case "scoutTimeoutMs": {
      settings.scoutTimeoutMs = Number(value);
      return true;
    }
    case "jevDigestMaxChars": {
      settings.jevDigestMaxChars = Number(value);
      return true;
    }
    case "jevPricePerMtok": {
      settings.jevPricePerMtok = Number(value);
      return true;
    }
    case "jevTransport": {
      // SAFETY: value comes from the fixed jevTransport options of the settings list.
      settings.jevTransport = value as AdvisorSettings["jevTransport"];
      return true;
    }
    default: {
      return false;
    }
  }
};

export const mutateAdvisorSettings = (
  settings: AdvisorSettings,
  id: string,
  value: string,
  presets: ContextPreset[]
): void => {
  if (applyCoreMutation(settings, id, value, presets)) {
    return;
  }
  if (applyNumericMutation(settings, id, value)) {
    return;
  }
  if (applyJevMutation(settings, id, value)) {
    return;
  }
  if (BOOLEAN_SETTING_IDS.has(id)) {
    // SAFETY: BOOLEAN_SETTING_IDS only contains AdvisorSettings boolean fields.
    settings[id as BooleanSettingField] = value === "On";
  }
};
