import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import { isValidAdvisorToolPolicies } from "../config/validation.js";
import {
  contextDescription,
  currentContextLabel,
  currentEffort,
  maxCallValues,
  numericValues,
  settingValue,
  TOGGLE_VALUES,
  withCurrentValue,
} from "./settings-formatting.js";
import { TextSettingSubmenu } from "./text-setting-submenu.js";
import type {
  AdvisorSettings,
  ContextPreset,
  RenderRequester,
} from "./types.js";

export interface SettingsItemsOptions {
  effortLevels: string[];
  presets: ContextPreset[];
  settings: AdvisorSettings;
  theme: Theme;
  tui: RenderRequester;
}

const toggle = (
  id: string,
  label: string,
  description: string,
  value: boolean | undefined,
  defaultValue: boolean
): SettingItem => ({
  currentValue: settingValue(value, defaultValue),
  description,
  id,
  label,
  values: TOGGLE_VALUES,
});

export const createSettingsItems = ({
  effortLevels,
  presets,
  settings,
  theme,
  tui,
}: SettingsItemsOptions): SettingItem[] => {
  const items: SettingItem[] = [
    {
      currentValue: currentContextLabel(presets, settings.contextMaxChars),
      description: contextDescription(presets, settings.contextMaxChars),
      id: "context",
      label: "Context window",
      values: presets.map((preset) => preset.label),
    },
    {
      currentValue: settingValue(settings.simpleMode, false),
      description:
        "Keep the Advisor available on demand without automatic gates or blocks.",
      id: "simpleMode",
      label: "Simple mode",
      values: TOGGLE_VALUES,
    },
    {
      currentValue: settingValue(settings.alwaysOn, false),
      description:
        "Run the Advisor flow automatically for supported agent turns.",
      id: "alwaysOn",
      label: "Always on",
      values: TOGGLE_VALUES,
    },
  ];
  if (settings.simpleMode) {
    return items;
  }

  items.push(
    {
      currentValue: currentEffort(settings.effort),
      description: "Reasoning level used for Advisor calls.",
      id: "effort",
      label: "Advisor reasoning",
      values: withCurrentValue(currentEffort(settings.effort), effortLevels),
    },
    toggle(
      "scoutEnabled",
      "Experimental Advisor Scout",
      "Enable the experimental Scout before Advisor calls.",
      settings.scoutEnabled,
      false
    ),
    toggle(
      "showUsageDetails",
      "Show usage and cost details",
      "Show token usage and cost details in Advisor responses.",
      settings.showUsageDetails,
      true
    ),
    toggle(
      "showUsageFooter",
      "Show usage in footer",
      "Show the current Advisor usage summary in the footer.",
      settings.showUsageFooter,
      false
    ),
    toggle(
      "planGate",
      "Plan gate",
      "Ask the Advisor to review implementation plans.",
      settings.planGate,
      true
    ),
    toggle(
      "failureGate",
      "Failure gate",
      "Ask the Advisor to review repeated failures.",
      settings.failureGate,
      true
    ),
    toggle(
      "completionGate",
      "Completion gate",
      "Ask the Advisor to review work before declaring success.",
      settings.completionGate,
      true
    ),
    toggle(
      "collapseResponses",
      "Collapse long responses",
      "Collapse long Advisor responses in the transcript.",
      settings.collapseResponses,
      false
    ),
    {
      currentValue: settings.customRule || "None",
      description: "Add a rule that triggers Advisor involvement.",
      id: "customRule",
      label: "Custom invocation",
      submenu: (_currentValue, done) =>
        new TextSettingSubmenu({
          description: "Enter a custom invocation rule.",
          initial: settings.customRule || "",
          onCancel: done,
          onSubmit: (value) => ({ value: value.trim() }),
          theme,
          title: "Custom invocation",
          tui,
        }),
    },
    toggle(
      "blockOnBlocked",
      "Block on critical advice",
      "Block the agent when the Advisor returns a critical decision.",
      settings.blockOnBlocked,
      true
    ),
    toggle(
      "autoLoopGate",
      "Automatic loop gate",
      "Ask the Advisor to review repeated equivalent attempts.",
      settings.autoLoopGate,
      true
    ),
    {
      currentValue: `After ${settings.loopThreshold ?? 3} repeats`,
      description: "Number of equivalent attempts before automatic review.",
      id: "loopThreshold",
      label: "Loop threshold",
      values: numericValues(
        settings.loopThreshold ?? 3,
        Array.from({ length: 99 }, (_, index) => index + 2)
      ).map((value) => `After ${value} repeats`),
    },
    {
      currentValue:
        settings.maxCallsPerSession === undefined
          ? "∞"
          : String(settings.maxCallsPerSession),
      description: "Limit automatic Advisor calls in one session.",
      id: "maxCallsPerSession",
      label: "Max Advisor calls/session",
      values: maxCallValues(
        settings.maxCallsPerSession === undefined
          ? "∞"
          : String(settings.maxCallsPerSession)
      ),
    },
    toggle(
      "sessionSummary",
      "Session Advisor Summary",
      "Show a local summary when the session ends.",
      settings.sessionSummary,
      false
    ),
    {
      currentValue: settings.failureMode ?? "block-session",
      description: "Choose what happens when an Advisor gate fails.",
      id: "failureMode",
      label: "Gate failure mode",
      values: withCurrentValue(settings.failureMode ?? "block-session", [
        "block-session",
        "block-tool",
        "warn-and-continue",
      ]),
    },
    toggle(
      "herdrIntegration",
      "Herdr integration",
      "Send Advisor activity to the optional Herdr integration.",
      settings.herdrIntegration,
      true
    ),
    {
      currentValue: String(settings.toolResultMaxLines ?? 2000),
      description: "Maximum lines included from a tool result.",
      id: "toolResultMaxLines",
      label: "Tool result lines",
      values: numericValues(
        settings.toolResultMaxLines ?? 2000,
        [0, 500, 1000, 2000, 5000, 10_000]
      ),
    },
    {
      currentValue: String(settings.toolResultMaxBytes ?? 50 * 1024),
      description: "Maximum bytes included from a tool result.",
      id: "toolResultMaxBytes",
      label: "Tool result bytes",
      values: numericValues(settings.toolResultMaxBytes ?? 50 * 1024, [
        0,
        10 * 1024,
        50 * 1024,
        100 * 1024,
        500 * 1024,
      ]),
    },
    toggle(
      "redactSecrets",
      "Redact common secrets",
      "Redact common credential patterns before Advisor calls.",
      settings.redactSecrets,
      false
    ),
    {
      currentValue: settings.gitContext ?? "summary",
      description: "How much repository context is shared with the Advisor.",
      id: "gitContext",
      label: "Repository context",
      values: withCurrentValue(settings.gitContext ?? "summary", [
        "off",
        "summary",
        "full",
      ]),
    },
    {
      currentValue: String(settings.gitContextMaxChars ?? 20_000),
      description: "Maximum repository context characters included.",
      id: "gitContextMaxChars",
      label: "Repository context chars",
      values: numericValues(
        settings.gitContextMaxChars ?? 20_000,
        [0, 5000, 10_000, 20_000, 50_000, 100_000]
      ),
    },
    {
      currentValue: Object.keys(settings.toolPolicies ?? {}).length
        ? "Configured"
        : "All tools: full",
      description:
        "Choose which tools are shared in full, summarized, or excluded.",
      id: "toolPolicies",
      label: "Tool disclosure policies",
      submenu: (_currentValue, done) =>
        new TextSettingSubmenu({
          description:
            'Enter a JSON object with "full", "summary", or "exclude" values.',
          initial: JSON.stringify(settings.toolPolicies ?? {}),
          onCancel: done,
          onSubmit: (value) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(value || "{}");
            } catch {
              return { error: "Enter a valid JSON object." };
            }
            if (!isValidAdvisorToolPolicies(parsed)) {
              return {
                error:
                  "Use non-empty tool names with full, summary, or exclude values.",
              };
            }
            return { value: JSON.stringify(parsed) };
          },
          theme,
          title: "Tool disclosure policies",
          tui,
        }),
    },
    toggle(
      "trackedFileContent",
      "Tracked file content",
      "Allow tracked file contents to be sent with Advisor context.",
      settings.trackedFileContent,
      false
    ),
    toggle(
      "untrackedContent",
      "Untracked file content",
      "Allow untracked file contents to be sent with Advisor context.",
      settings.untrackedContent,
      false
    ),
    toggle(
      "outcomeLogging",
      "Outcome logging (global)",
      "Allow anonymized Advisor outcomes to be logged globally.",
      settings.outcomeLogging,
      false
    )
  );
  return items;
};
