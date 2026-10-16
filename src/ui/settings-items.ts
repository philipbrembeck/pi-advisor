import type { Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import type { KeybindingsManager, SettingItem } from "@earendil-works/pi-tui";

import {
  DEFAULT_JEV_DIGEST_MAX_CHARS,
  DEFAULT_JEV_FILTER_NOUL_MARGIN,
  DEFAULT_JEV_FILTER_OVERRIDE_WINDOW,
  DEFAULT_JEV_FILTER_SKIP_CONFIDENCE,
  DEFAULT_JEV_TIMEOUT_MS,
  DEFAULT_JEV_TURN_GATE_NOUL_THRESHOLD,
  DEFAULT_SCOUT_TIMEOUT_MS,
} from "../config/types.ts";
import { isValidAdvisorToolPolicies } from "../config/validation.ts";
import type { JevClassifierKeySnapshot } from "../jev/classifier-key-store.ts";
import { JevClassifierSubmenu } from "./jev-classifier-submenu.ts";
import { JevFilterSubmenu } from "./jev-filter-submenu.ts";
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
    description:
      "Maximum time for Scout's response stream; model and auth resolution happen before this timeout starts.",
    id: "scoutTimeoutMs",
    label: "Scout timeout ms",
    values: numericValues(
      timeoutMs,
      [5000, 10_000, 15_000, 30_000, 45_000, 60_000, 90_000, 120_000]
    ),
  };
};

const jevFilterRowValue = (settings: AdvisorSettings) => {
  if (!settings.jevFilterEnabled) {
    return "Off";
  }

  return settings.jevClassifier ? "On" : "On (unavailable: no classifier)";
};

const jevItems = (
  settings: AdvisorSettings,
  theme: Theme,
  tui: RenderRequester,
  jevClassifierRegistry?: JevClassifierRegistryAccess,
  jevKeyDeps?: SettingsItemsOptions["jevKeyDeps"],
  onJevFilter?: (selection: JevFilterSelection) => boolean,
  onJevProvider?: (selection: JevProviderSelection) => boolean
): SettingItem[] => [
  {
    currentValue: settings.jevClassifier ?? "Choose classifier",
    description:
      "Select a Pi-authenticated classifier or explicitly configure the separate Jev API Key option.",
    id: "jevProvider",
    label: "Jev classifier",
    submenu: (currentValue, done) =>
      new JevClassifierSubmenu({
        currentValue,
        done,
        keybindings: getKeybindings(),
        modelRegistry: jevClassifierRegistry,
        onSelection: onJevProvider,
        persistKey: jevKeyDeps?.persistClassifierKey,
        resolveStoredKey: jevKeyDeps?.resolveClassifierKey,
        restoreKey: jevKeyDeps?.restoreClassifierKey,
        theme,
        tui,
      }),
  },
  {
    currentValue: jevFilterRowValue(settings),
    description:
      "Screen low-stakes ask_advisor consultations with the selected Jev provider.",
    id: "jevFilter",
    label: "Jev/Decisions consultation filter",
    submenu: (currentValue, done) =>
      new JevFilterSubmenu({
        currentClassifier: settings.jevClassifier,
        currentValue,
        done,
        modelRegistry: jevClassifierRegistry,
        onSelection: onJevFilter,
        resolveClassifierKey: jevKeyDeps?.resolveClassifierKey,
        theme,
        tui,
      }),
  },
  {
    currentValue: String(
      settings.jevFilterSkipConfidence ?? DEFAULT_JEV_FILTER_SKIP_CONFIDENCE
    ),
    description:
      "Required probability on negligible stakes before a consultation is skipped.",
    id: "jevFilterSkipConfidence",
    label: "Jev skip confidence",
    values: numericValues(
      settings.jevFilterSkipConfidence ?? DEFAULT_JEV_FILTER_SKIP_CONFIDENCE,
      [0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
    ),
  },
  {
    currentValue: String(
      settings.jevFilterNoulMargin ?? DEFAULT_JEV_FILTER_NOUL_MARGIN
    ),
    description:
      "Extra margin over a coin flip required on self-answerability before skipping.",
    id: "jevFilterNoulMargin",
    label: "Jev Noul margin",
    values: numericValues(
      settings.jevFilterNoulMargin ?? DEFAULT_JEV_FILTER_NOUL_MARGIN,
      [0.1, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45]
    ),
  },
  {
    currentValue: `${settings.jevFilterOverrideWindow ?? DEFAULT_JEV_FILTER_OVERRIDE_WINDOW} turns`,
    description:
      "Turns after a skip during which the same question passes automatically.",
    id: "jevFilterOverrideWindow",
    label: "Jev override window",
    values: numericValues(
      settings.jevFilterOverrideWindow ?? DEFAULT_JEV_FILTER_OVERRIDE_WINDOW,
      [0, 3, 5, 10, 20, 50]
    ).map((value) => `${value} turns`),
  },
  {
    currentValue: String(settings.jevTimeoutMs ?? DEFAULT_JEV_TIMEOUT_MS),
    description: "Total wall-time budget for one Jev call, including retries.",
    id: "jevTimeoutMs",
    label: "Jev timeout ms",
    values: numericValues(
      settings.jevTimeoutMs ?? DEFAULT_JEV_TIMEOUT_MS,
      [1000, 2000, 5000, 8000, 15_000, 30_000]
    ),
  },
  {
    currentValue: String(
      settings.jevDigestMaxChars ?? DEFAULT_JEV_DIGEST_MAX_CHARS
    ),
    description: "Conversation characters sent to Jev as screening evidence.",
    id: "jevDigestMaxChars",
    label: "Jev digest chars",
    values: numericValues(
      settings.jevDigestMaxChars ?? DEFAULT_JEV_DIGEST_MAX_CHARS,
      [0, 1000, 2000, 4000, 8000, 15_000]
    ),
  },

  {
    currentValue:
      settings.jevTurnGateEveryTurns === 0 ||
      settings.jevTurnGateEveryTurns === undefined
        ? "Off"
        : `every ${settings.jevTurnGateEveryTurns} turns`,
    description:
      "Proactively consult the Advisor every N turns without a consultation (0 = off).",
    id: "jevTurnGateEveryTurns",
    label: "Jev/Decisions turn gate",
    values: [
      "Off",
      "every 3 turns",
      "every 5 turns",
      "every 10 turns",
      "every 20 turns",
    ],
  },
  {
    currentValue: String(
      settings.jevTurnGateNoulThreshold ?? DEFAULT_JEV_TURN_GATE_NOUL_THRESHOLD
    ),
    description:
      "Jev confidence required before the turn gate interrupts with advice.",
    id: "jevTurnGateNoulThreshold",
    label: "Jev/Decisions turn-gate threshold",
    values: numericValues(
      settings.jevTurnGateNoulThreshold ?? DEFAULT_JEV_TURN_GATE_NOUL_THRESHOLD,
      [0.6, 0.7, 0.8, 0.85, 0.9, 0.95]
    ),
  },
];

export const advisorFallbackModelItem = (
  settings: AdvisorSettings,
  modelRefs: string[] | undefined,
  keybindings: KeybindingsManager | undefined,
  theme: Theme,
  tui: RenderRequester
): SettingItem => ({
  currentValue: settings.fallbackModel ?? FALLBACK_ADVISOR_MODEL_DISABLED,
  description:
    "Retry a failed Advisor request once with this optional model; the primary model remains unchanged.",
  id: "fallbackModel",
  label: "Fallback Advisor model",
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
      title: "Fallback Advisor model",
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
    : "Any model",
  description:
    "Only the exact provider/model references listed here may call the Advisor; an empty list allows every model.",
  id: "modelWhitelist",
  label: "Advisor model whitelist",
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
      title: "Advisor model whitelist",
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
      label: "Context window",
      values: presets.map((preset) => preset.label),
    },
    {
      currentValue: settingValue(settings.advisorToolsEnabled, true),
      description:
        "Allow the model to call the Advisor tools; /advisor-off disables them across sessions.",
      id: "advisorToolsEnabled",
      label: "Advisor tools",
      values: TOGGLE_VALUES,
    },
    {
      currentValue: settingValue(settings.simpleMode, false),
      description:
        "Keep enabled Advisor tools available on demand without automatic gates or blocks.",
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
    fallbackModel,
  ];

  if (settings.simpleMode) {
    items.push(
      modelWhitelist,
      toggle(
        "disableSameModel",
        "Disable same-model Advisor",
        "Skip advice when the active Executor and Advisor use the same provider/model; turn off to allow higher-effort same-model reviews.",
        settings.disableSameModel,
        true
      )
    );

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
    modelWhitelist,
    toggle(
      "disableSameModel",
      "Disable same-model Advisor",
      "Skip advice when the active Executor and Advisor use the same provider/model; turn off to allow higher-effort same-model reviews.",
      settings.disableSameModel,
      true
    ),
    toggle(
      "scoutEnabled",
      "Experimental Advisor Scout",
      "Enable the experimental Scout before Advisor calls.",
      settings.scoutEnabled,
      false
    ),
    scoutTimeoutItem(settings),
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
    toggle(
      "agentsMdContext",
      "AGENTS.md context",
      "Include trusted project and global AGENTS.md rules in Advisor calls.",
      settings.agentsMdContext,
      true
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
    ),
    ...jevItems(
      settings,
      theme,
      tui,
      jevClassifierRegistry,
      jevKeyDeps,
      onJevFilter,
      onJevProvider
    )
  );

  return items;
};
