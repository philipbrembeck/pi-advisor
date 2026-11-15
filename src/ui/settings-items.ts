import type { Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import type { KeybindingsManager, SettingItem } from "@earendil-works/pi-tui";

import { DEFAULT_SCOUT_TIMEOUT_MS } from "../config/types.ts";
import { isValidAdvisorToolPolicies } from "../config/validation.ts";
import { t } from "../i18n.ts";
import type { JevClassifierKeySnapshot } from "../jev/classifier-key-store.ts";
import { SearchableModelMultiSelector } from "./model-multi-selector.ts";
import { SearchableModelSelector } from "./model-selector.ts";
import {
  contextDescription,
  currentContextLabel,
  currentEffort,
  maxCallValues,
  numericValues,
  settingValue,
  TOGGLE_VALUES,
  withCurrentValue,
} from "./settings-formatting.ts";
import { jevItems } from "./settings-items-jev.ts";
import { TextSettingSubmenu } from "./text-setting-submenu.ts";
import { FALLBACK_ADVISOR_MODEL_DISABLED } from "./types.ts";
import type {
  AdvisorSettings,
  ContextPreset,
  JevClassifierRegistryAccess,
  JevFilterSelection,
  JevProviderSelection,
  RenderRequester,
} from "./types.ts";

export interface SettingsItemsOptions {
  effortLevels: string[];
  fallbackModel: SettingItem;
  modelWhitelist: SettingItem;
  presets: ContextPreset[];
  settings: AdvisorSettings;
  jevClassifierRegistry?: JevClassifierRegistryAccess;
  jevKeyDeps?: {
    resolveClassifierKey?: () => Promise<JevClassifierKeySnapshot>;
    persistClassifierKey?: (
      key: string
    ) => Promise<{ ok: boolean; message: string }>;
    restoreClassifierKey?: (
      previous: JevClassifierKeySnapshot
    ) => Promise<boolean>;
  };
  onJevFilter?: (selection: JevFilterSelection) => boolean;
  onJevProvider?: (selection: JevProviderSelection) => boolean;
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

const scoutTimeoutItem = (settings: AdvisorSettings): SettingItem => {
  const timeoutMs = settings.scoutTimeoutMs ?? DEFAULT_SCOUT_TIMEOUT_MS;

  return {
    currentValue: String(timeoutMs),
    description: t(
      "settings.scoutTimeoutMs.desc",
      "Maximum time for Scout's response stream; model and auth resolution happen before this timeout starts."
    ),
    id: "scoutTimeoutMs",
    label: t("settings.scoutTimeoutMs.label", "Scout timeout ms"),
    values: numericValues(
      timeoutMs,
      [5000, 10_000, 15_000, 30_000, 45_000, 60_000, 90_000, 120_000]
    ),
  };
};

export const advisorFallbackModelItem = (
  settings: AdvisorSettings,
  modelRefs: string[] | undefined,
  keybindings: KeybindingsManager | undefined,
  theme: Theme,
  tui: RenderRequester
): SettingItem => ({
  currentValue: settings.fallbackModel ?? FALLBACK_ADVISOR_MODEL_DISABLED,
  description: t(
    "settings.fallbackModel.desc",
    "Retry a failed Advisor request once with this optional model; the primary model remains unchanged."
  ),
  id: "fallbackModel",
  label: t("settings.fallbackModel.label", "Fallback Advisor model"),
  submenu: (_currentValue, done) =>
    new SearchableModelSelector({
      allOptions: [
        FALLBACK_ADVISOR_MODEL_DISABLED,
        ...new Set(
          modelRefs ?? (settings.fallbackModel ? [settings.fallbackModel] : [])
        ),
      ],
      currentOption: settings.fallbackModel ?? FALLBACK_ADVISOR_MODEL_DISABLED,
      keybindings: keybindings ?? getKeybindings(),
      onCancel: done,
      onSelect: (value) =>
        done(value === FALLBACK_ADVISOR_MODEL_DISABLED ? "" : value),
      theme,
      title: t("settings.fallbackModel.label", "Fallback Advisor model"),
      tui,
    }),
});

export const advisorModelWhitelistItem = (
  settings: AdvisorSettings,
  modelRefs: string[] | undefined,
  keybindings: KeybindingsManager | undefined,
  theme: Theme,
  tui: RenderRequester
): SettingItem => ({
  currentValue: settings.modelWhitelist?.length
    ? settings.modelWhitelist.join(", ")
    : t("settings.modelWhitelist.any", "Any model"),
  description: t(
    "settings.modelWhitelist.desc",
    "Only the exact provider/model references listed here may call the Advisor; an empty list allows every model."
  ),
  id: "modelWhitelist",
  label: t("settings.modelWhitelist.label", "Advisor model whitelist"),
  submenu: (_currentValue, done) =>
    new SearchableModelMultiSelector({
      allOptions: [
        ...new Set([...(modelRefs ?? []), ...(settings.modelWhitelist ?? [])]),
      ],
      currentOptions: settings.modelWhitelist ?? [],
      keybindings: keybindings ?? getKeybindings(),
      multiSelect: true,
      onCancel: done,
      onSelect: (values) => done(values.join(",")),
      theme,
      title: t("settings.modelWhitelist.label", "Advisor model whitelist"),
      tui,
    }),
});

export const createSettingsItems = ({
  effortLevels,
  fallbackModel,
  modelWhitelist,
  presets,
  settings,
  jevClassifierRegistry,
  jevKeyDeps,
  onJevFilter,
  onJevProvider,
  theme,
  tui,
}: SettingsItemsOptions): SettingItem[] => {
  const items: SettingItem[] = [
    {
      currentValue: currentContextLabel(presets, settings.contextMaxChars),
      description: contextDescription(presets, settings.contextMaxChars),
      id: "context",
      label: t("settings.context.label", "Context window"),
      values: presets.map((preset) => preset.label),
    },
    {
      currentValue: settingValue(settings.advisorToolsEnabled, true),
      description: t(
        "settings.advisorToolsEnabled.desc",
        "Allow the model to call the Advisor tools; /advisor-off disables them across sessions."
      ),
      id: "advisorToolsEnabled",
      label: t("settings.advisorToolsEnabled.label", "Advisor tools"),
      values: TOGGLE_VALUES,
    },
    {
      currentValue: settingValue(settings.simpleMode, false),
      description: t(
        "settings.simpleMode.desc",
        "Keep enabled Advisor tools available on demand without automatic gates or blocks."
      ),
      id: "simpleMode",
      label: t("settings.simpleMode.label", "Simple mode"),
      values: TOGGLE_VALUES,
    },
    {
      currentValue: settingValue(settings.alwaysOn, false),
      description: t(
        "settings.alwaysOn.desc",
        "Run the Advisor flow automatically for supported agent turns."
      ),
      id: "alwaysOn",
      label: t("settings.alwaysOn.label", "Always on"),
      values: TOGGLE_VALUES,
    },
    fallbackModel,
  ];

  if (settings.simpleMode) {
    items.push(
      modelWhitelist,
      toggle(
        "disableSameModel",
        t("settings.disableSameModel.label", "Disable same-model Advisor"),
        t(
          "settings.disableSameModel.desc",
          "Skip advice when the active Executor and Advisor use the same provider/model; turn off to allow higher-effort same-model reviews."
        ),
        settings.disableSameModel,
        true
      )
    );

    return items;
  }

  items.push(
    {
      currentValue: currentEffort(settings.effort),
      description: t(
        "settings.effort.desc",
        "Reasoning level used for Advisor calls."
      ),
      id: "effort",
      label: t("settings.effort.label", "Advisor reasoning"),
      values: withCurrentValue(currentEffort(settings.effort), effortLevels),
    },
    modelWhitelist,
    toggle(
      "disableSameModel",
      t("settings.disableSameModel.label", "Disable same-model Advisor"),
      t(
        "settings.disableSameModel.desc",
        "Skip advice when the active Executor and Advisor use the same provider/model; turn off to allow higher-effort same-model reviews."
      ),
      settings.disableSameModel,
      true
    ),
    toggle(
      "scoutEnabled",
      t("settings.scoutEnabled.label", "Experimental Advisor Scout"),
      t(
        "settings.scoutEnabled.desc",
        "Enable the experimental Scout before Advisor calls."
      ),
      settings.scoutEnabled,
      false
    ),
    scoutTimeoutItem(settings),
    toggle(
      "showUsageDetails",
      t("settings.showUsageDetails.label", "Show usage and cost details"),
      t(
        "settings.showUsageDetails.desc",
        "Show token usage and cost details in Advisor responses."
      ),
      settings.showUsageDetails,
      true
    ),
    toggle(
      "showUsageFooter",
      t("settings.showUsageFooter.label", "Show usage in footer"),
      t(
        "settings.showUsageFooter.desc",
        "Show the current Advisor usage summary in the footer."
      ),
      settings.showUsageFooter,
      false
    ),
    toggle(
      "planGate",
      t("settings.planGate.label", "Plan gate"),
      t(
        "settings.planGate.desc",
        "Ask the Advisor to review implementation plans."
      ),
      settings.planGate,
      true
    ),
    toggle(
      "failureGate",
      t("settings.failureGate.label", "Failure gate"),
      t(
        "settings.failureGate.desc",
        "Ask the Advisor to review repeated failures."
      ),
      settings.failureGate,
      true
    ),
    toggle(
      "completionGate",
      t("settings.completionGate.label", "Completion gate"),
      t(
        "settings.completionGate.desc",
        "Ask the Advisor to review work before declaring success."
      ),
      settings.completionGate,
      true
    ),
    toggle(
      "collapseResponses",
      t("settings.collapseResponses.label", "Collapse long responses"),
      t(
        "settings.collapseResponses.desc",
        "Collapse long Advisor responses in the transcript."
      ),
      settings.collapseResponses,
      false
    ),
    {
      currentValue: settings.customRule || t("settings.none", "None"),
      description: t(
        "settings.customRule.desc",
        "Add a rule that triggers Advisor involvement."
      ),
      id: "customRule",
      label: t("settings.customRule.label", "Custom invocation"),
      submenu: (_currentValue, done) =>
        new TextSettingSubmenu({
          description: t(
            "settings.customRule.submenuDesc",
            "Enter a custom invocation rule."
          ),
          initial: settings.customRule || "",
          onCancel: done,
          onSubmit: (value) => ({ value: value.trim() }),
          theme,
          title: t("settings.customRule.label", "Custom invocation"),
          tui,
        }),
    },
    toggle(
      "blockOnBlocked",
      t("settings.blockOnBlocked.label", "Block on critical advice"),
      t(
        "settings.blockOnBlocked.desc",
        "Block the agent when the Advisor returns a critical decision."
      ),
      settings.blockOnBlocked,
      true
    ),
    toggle(
      "autoLoopGate",
      t("settings.autoLoopGate.label", "Automatic loop gate"),
      t(
        "settings.autoLoopGate.desc",
        "Ask the Advisor to review repeated equivalent attempts."
      ),
      settings.autoLoopGate,
      true
    ),
    {
      currentValue: `${t("settings.loopThreshold.after", "After")} ${settings.loopThreshold ?? 3} ${t("settings.loopThreshold.repeats", "repeats")}`,
      description: t(
        "settings.loopThreshold.desc",
        "Number of equivalent attempts before automatic review."
      ),
      id: "loopThreshold",
      label: t("settings.loopThreshold.label", "Loop threshold"),
      values: numericValues(
        settings.loopThreshold ?? 3,
        Array.from({ length: 99 }, (_, index) => index + 2)
      ).map(
        (value) =>
          `${t("settings.loopThreshold.after", "After")} ${value} ${t("settings.loopThreshold.repeats", "repeats")}`
      ),
    },
    {
      currentValue:
        settings.maxCallsPerSession === undefined
          ? "∞"
          : String(settings.maxCallsPerSession),
      description: t(
        "settings.maxCallsPerSession.desc",
        "Limit automatic Advisor calls in one session."
      ),
      id: "maxCallsPerSession",
      label: t(
        "settings.maxCallsPerSession.label",
        "Max Advisor calls/session"
      ),
      values: maxCallValues(
        settings.maxCallsPerSession === undefined
          ? "∞"
          : String(settings.maxCallsPerSession)
      ),
    },
    toggle(
      "sessionSummary",
      t("settings.sessionSummary.label", "Session Advisor Summary"),
      t(
        "settings.sessionSummary.desc",
        "Show a local summary when the session ends."
      ),
      settings.sessionSummary,
      false
    ),
    toggle(
      "logFeedback",
      t("settings.logFeedback.label", "Advisor log feedback"),
      t(
        "settings.logFeedback.desc",
        "Include budget and Scout status messages in session logs. Actual Advisor calls and results remain visible either way."
      ),
      settings.logFeedback,
      false
    ),
    {
      currentValue: settings.failureMode ?? "block-session",
      description: t(
        "settings.failureMode.desc",
        "Choose what happens when an Advisor gate fails."
      ),
      id: "failureMode",
      label: t("settings.failureMode.label", "Gate failure mode"),
      values: withCurrentValue(settings.failureMode ?? "block-session", [
        "block-session",
        "block-tool",
        "warn-and-continue",
      ]),
    },
    toggle(
      "herdrIntegration",
      t("settings.herdrIntegration.label", "Herdr integration"),
      t(
        "settings.herdrIntegration.desc",
        "Send Advisor activity to the optional Herdr integration."
      ),
      settings.herdrIntegration,
      true
    ),
    {
      currentValue: String(settings.toolResultMaxLines ?? 2000),
      description: t(
        "settings.toolResultMaxLines.desc",
        "Maximum lines included from a tool result."
      ),
      id: "toolResultMaxLines",
      label: t("settings.toolResultMaxLines.label", "Tool result lines"),
      values: numericValues(
        settings.toolResultMaxLines ?? 2000,
        [0, 500, 1000, 2000, 5000, 10_000]
      ),
    },
    {
      currentValue: String(settings.toolResultMaxBytes ?? 50 * 1024),
      description: t(
        "settings.toolResultMaxBytes.desc",
        "Maximum bytes included from a tool result."
      ),
      id: "toolResultMaxBytes",
      label: t("settings.toolResultMaxBytes.label", "Tool result bytes"),
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
      t("settings.redactSecrets.label", "Redact common secrets"),
      t(
        "settings.redactSecrets.desc",
        "Redact common credential patterns before Advisor calls."
      ),
      settings.redactSecrets,
      false
    ),
    toggle(
      "agentsMdContext",
      t("settings.agentsMdContext.label", "AGENTS.md context"),
      t(
        "settings.agentsMdContext.desc",
        "Include trusted project and global AGENTS.md rules in Advisor calls."
      ),
      settings.agentsMdContext,
      true
    ),
    {
      currentValue: settings.gitContext ?? "summary",
      description: t(
        "settings.gitContext.desc",
        "How much repository context is shared with the Advisor."
      ),
      id: "gitContext",
      label: t("settings.gitContext.label", "Repository context"),
      values: withCurrentValue(settings.gitContext ?? "summary", [
        "off",
        "summary",
        "full",
      ]),
    },
    {
      currentValue: String(settings.gitContextMaxChars ?? 20_000),
      description: t(
        "settings.gitContextMaxChars.desc",
        "Maximum repository context characters included."
      ),
      id: "gitContextMaxChars",
      label: t("settings.gitContextMaxChars.label", "Repository context chars"),
      values: numericValues(
        settings.gitContextMaxChars ?? 20_000,
        [0, 5000, 10_000, 20_000, 50_000, 100_000]
      ),
    },
    {
      currentValue: Object.keys(settings.toolPolicies ?? {}).length
        ? t("settings.toolPolicies.configured", "Configured")
        : t("settings.toolPolicies.allToolsFull", "All tools: full"),
      description: t(
        "settings.toolPolicies.desc",
        "Choose which tools are shared in full, summarized, or excluded."
      ),
      id: "toolPolicies",
      label: t("settings.toolPolicies.label", "Tool disclosure policies"),
      submenu: (_currentValue, done) =>
        new TextSettingSubmenu({
          description: t(
            "settings.toolPolicies.submenuDesc",
            'Enter a JSON object with "full", "summary", or "exclude" values.'
          ),
          initial: JSON.stringify(settings.toolPolicies ?? {}),
          onCancel: done,
          onSubmit: (value) => {
            let parsed: unknown;

            try {
              parsed = JSON.parse(value || "{}");
            } catch {
              return {
                error: t(
                  "settings.toolPolicies.invalidJson",
                  "Enter a valid JSON object."
                ),
              };
            }

            if (!isValidAdvisorToolPolicies(parsed)) {
              return {
                error: t(
                  "settings.toolPolicies.invalidPolicies",
                  "Use non-empty tool names with full, summary, or exclude values."
                ),
              };
            }

            return { value: JSON.stringify(parsed) };
          },
          theme,
          title: t("settings.toolPolicies.label", "Tool disclosure policies"),
          tui,
        }),
    },
    toggle(
      "trackedFileContent",
      t("settings.trackedFileContent.label", "Tracked file content"),
      t(
        "settings.trackedFileContent.desc",
        "Allow tracked file contents to be sent with Advisor context."
      ),
      settings.trackedFileContent,
      false
    ),
    toggle(
      "untrackedContent",
      t("settings.untrackedContent.label", "Untracked file content"),
      t(
        "settings.untrackedContent.desc",
        "Allow untracked file contents to be sent with Advisor context."
      ),
      settings.untrackedContent,
      false
    ),
    toggle(
      "outcomeLogging",
      t("settings.outcomeLogging.label", "Outcome logging (global)"),
      t(
        "settings.outcomeLogging.desc",
        "Allow anonymized Advisor outcomes to be logged globally."
      ),
      settings.outcomeLogging,
      false
    ),
    ...jevItems(settings, theme, tui, {
      jevClassifierRegistry,
      jevKeyDeps,
      onJevFilter,
      onJevProvider,
    })
  );

  return items;
};
