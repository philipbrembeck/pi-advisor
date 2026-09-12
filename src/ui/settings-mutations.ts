import type { AdvisorSettings, ContextPreset, SettingValue } from "./types.ts";

export const BOOLEAN_SETTING_IDS = new Set([
  "scoutEnabled",
  "showUsageDetails",
  "showUsageFooter",
  "planGate",
  "failureGate",
  "completionGate",
  "collapseResponses",
  "blockOnBlocked",
  "autoLoopGate",
  "sessionSummary",
  "herdrIntegration",
  "redactSecrets",
  "trackedFileContent",
  "untrackedContent",
  "outcomeLogging",
]);

export const mutateAdvisorSettings = (
  settings: AdvisorSettings,
  id: string,
  value: string,
  presets: ContextPreset[]
): void => {
  switch (id) {
    case "context":
      settings.contextMaxChars =
        presets.find((preset) => preset.label === value)?.value ??
        settings.contextMaxChars;
      break;
    case "simpleMode":
      settings.simpleMode = value === "On";
      break;
    case "alwaysOn":
      settings.alwaysOn = value === "On";
      break;
    case "effort":
      settings.effort = value;
      break;
    case "customRule":
      settings.customRule = value.trim() || undefined;
      break;
    case "toolPolicies":
      settings.toolPolicies = JSON.parse(
        value
      ) as AdvisorSettings["toolPolicies"];
      break;
    case "loopThreshold":
      settings.loopThreshold = Number(
        value.replace("After ", "").replace(" repeats", "")
      );
      break;
    case "maxCallsPerSession":
      settings.maxCallsPerSession = value === "∞" ? undefined : Number(value);
      break;
    case "failureMode":
      settings.failureMode = value as AdvisorSettings["failureMode"];
      break;
    case "gitContext":
      settings.gitContext = value as AdvisorSettings["gitContext"];
      break;
    case "toolResultMaxLines":
      settings.toolResultMaxLines = Number(value);
      break;
    case "toolResultMaxBytes":
      settings.toolResultMaxBytes = Number(value);
      break;
    case "gitContextMaxChars":
      settings.gitContextMaxChars = Number(value);
      break;
    default:
      if (BOOLEAN_SETTING_IDS.has(id)) {
        (settings as unknown as Record<string, SettingValue | boolean>)[id] =
          value === "On";
      }
      break;
  }
};
