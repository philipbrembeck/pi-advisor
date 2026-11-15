import type { Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import type { SettingItem } from "@earendil-works/pi-tui";

import {
  DEFAULT_JEV_DIGEST_MAX_CHARS,
  DEFAULT_JEV_FILTER_NOUL_MARGIN,
  DEFAULT_JEV_FILTER_OVERRIDE_WINDOW,
  DEFAULT_JEV_FILTER_SKIP_CONFIDENCE,
  DEFAULT_JEV_TIMEOUT_MS,
  DEFAULT_JEV_TURN_GATE_NOUL_THRESHOLD,
} from "../config/types.ts";
import { t } from "../i18n.ts";
import type { JevClassifierKeySnapshot } from "../jev/classifier-key-store.ts";
import { JevClassifierSubmenu } from "./jev-classifier-submenu.ts";
import { JevFilterSubmenu } from "./jev-filter-submenu.ts";
import { numericValues } from "./settings-formatting.ts";
import type {
  AdvisorSettings,
  JevClassifierRegistryAccess,
  JevFilterSelection,
  JevProviderSelection,
  RenderRequester,
} from "./types.ts";

export interface JevItemsDependencies {
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
}

const jevFilterRowValue = (settings: AdvisorSettings) => {
  if (!settings.jevFilterEnabled) {
    return "Off";
  }

  return settings.jevClassifier
    ? "On"
    : t("settings.jevFilter.onUnavailable", "On (unavailable: no classifier)");
};

export const jevItems = (
  settings: AdvisorSettings,
  theme: Theme,
  tui: RenderRequester,
  {
    jevClassifierRegistry,
    jevKeyDeps,
    onJevFilter,
    onJevProvider,
  }: JevItemsDependencies
): SettingItem[] => [
  {
    currentValue:
      settings.jevClassifier ??
      t("settings.jevProvider.choose", "Choose classifier"),
    description: t(
      "settings.jevProvider.desc",
      "Select a Pi-authenticated classifier or explicitly configure the separate Jev API Key option."
    ),
    id: "jevProvider",
    label: t("settings.jevProvider.label", "Jev classifier"),
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
    description: t(
      "settings.jevFilter.desc",
      "Screen low-stakes ask_advisor consultations with the selected Jev provider."
    ),
    id: "jevFilter",
    label: t("settings.jevFilter.label", "Jev/Decisions consultation filter"),
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
    description: t(
      "settings.jevFilterSkipConfidence.desc",
      "Required probability on negligible stakes before a consultation is skipped."
    ),
    id: "jevFilterSkipConfidence",
    label: t("settings.jevFilterSkipConfidence.label", "Jev skip confidence"),
    values: numericValues(
      settings.jevFilterSkipConfidence ?? DEFAULT_JEV_FILTER_SKIP_CONFIDENCE,
      [0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
    ),
  },
  {
    currentValue: String(
      settings.jevFilterNoulMargin ?? DEFAULT_JEV_FILTER_NOUL_MARGIN
    ),
    description: t(
      "settings.jevFilterNoulMargin.desc",
      "Extra margin over a coin flip required on self-answerability before skipping."
    ),
    id: "jevFilterNoulMargin",
    label: t("settings.jevFilterNoulMargin.label", "Jev Noul margin"),
    values: numericValues(
      settings.jevFilterNoulMargin ?? DEFAULT_JEV_FILTER_NOUL_MARGIN,
      [0.1, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45]
    ),
  },
  {
    currentValue: `${settings.jevFilterOverrideWindow ?? DEFAULT_JEV_FILTER_OVERRIDE_WINDOW} ${t("settings.jev.turnsUnit", "turns")}`,
    description: t(
      "settings.jevFilterOverrideWindow.desc",
      "Turns after a skip during which the same question passes automatically."
    ),
    id: "jevFilterOverrideWindow",
    label: t("settings.jevFilterOverrideWindow.label", "Jev override window"),
    values: numericValues(
      settings.jevFilterOverrideWindow ?? DEFAULT_JEV_FILTER_OVERRIDE_WINDOW,
      [0, 3, 5, 10, 20, 50]
    ).map((value) => `${value} ${t("settings.jev.turnsUnit", "turns")}`),
  },
  {
    currentValue: String(settings.jevTimeoutMs ?? DEFAULT_JEV_TIMEOUT_MS),
    description: t(
      "settings.jevTimeoutMs.desc",
      "Total wall-time budget for one Jev call, including retries."
    ),
    id: "jevTimeoutMs",
    label: t("settings.jevTimeoutMs.label", "Jev timeout ms"),
    values: numericValues(
      settings.jevTimeoutMs ?? DEFAULT_JEV_TIMEOUT_MS,
      [1000, 2000, 5000, 8000, 15_000, 30_000]
    ),
  },
  {
    currentValue: String(
      settings.jevDigestMaxChars ?? DEFAULT_JEV_DIGEST_MAX_CHARS
    ),
    description: t(
      "settings.jevDigestMaxChars.desc",
      "Conversation characters sent to Jev as screening evidence."
    ),
    id: "jevDigestMaxChars",
    label: t("settings.jevDigestMaxChars.label", "Jev digest chars"),
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
    description: t(
      "settings.jevTurnGateEveryTurns.desc",
      "Proactively consult the Advisor every N turns without a consultation (0 = off)."
    ),
    id: "jevTurnGateEveryTurns",
    label: t("settings.jevTurnGateEveryTurns.label", "Jev/Decisions turn gate"),
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
    description: t(
      "settings.jevTurnGateNoulThreshold.desc",
      "Jev confidence required before the turn gate interrupts with advice."
    ),
    id: "jevTurnGateNoulThreshold",
    label: t(
      "settings.jevTurnGateNoulThreshold.label",
      "Jev/Decisions turn-gate threshold"
    ),
    values: numericValues(
      settings.jevTurnGateNoulThreshold ?? DEFAULT_JEV_TURN_GATE_NOUL_THRESHOLD,
      [0.6, 0.7, 0.8, 0.85, 0.9, 0.95]
    ),
  },
];
