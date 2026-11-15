import { truncateToWidth } from "@earendil-works/pi-tui";

import { t } from "../i18n.ts";
import {
  canClearCredential,
  providerName,
  transportLabel,
} from "./jev-setup-support.ts";
import type {
  JevProviderAction,
  JevProviderSubmenuOptions,
  JevProviderViewState,
} from "./jev-setup-support.ts";

export interface JevProviderInput {
  render: (width: number) => string[];
}

const providerActions = (): JevProviderAction[] => [
  "typesafe",
  "openrouter",
  "openai-decisions",
  "typesafe-compatible",
];

export const setupActions = (
  state: JevProviderViewState
): JevProviderAction[] => {
  const actions = providerActions();

  if (state.canEnterKey) {
    actions.push("enter-key");
  }

  if (state.canReuseProviderLogin) {
    actions.push("reuse-provider-login");
  }

  if (state.credentials && canClearCredential(state.credentials)) {
    actions.push("clear-stored-key");
  }

  actions.push("done");

  return actions;
};

const setupLabels = (state: JevProviderViewState): string[] =>
  setupActions(state).map((action) => {
    if (action === "clear-stored-key") {
      return t("jevSetup.clearStoredKey", "Clear stored key");
    }

    if (action === "done") {
      return t("jevSetup.done", "Done");
    }

    if (action === "enter-key") {
      return `${t("jevSetup.enterKeyFor", "Enter an API key for")} ${providerName(
        state.selectedTransport ?? "typesafe"
      )}`;
    }

    if (action === "reuse-provider-login") {
      return t("jevSetup.reuseProviderLogin", "Reuse a Pi provider login");
    }

    if (action === "typesafe-compatible") {
      return `${providerName(action)}…`;
    }

    return providerName(action);
  });

const inputLines = (
  key: "base-url" | "key-entry" | "provider-id",
  state: JevProviderViewState,
  input: JevProviderInput,
  width: number
): string[] => {
  const rendered = input.render(Math.max(10, width - 4))[0] ?? "";

  const titles = {
    "base-url": [
      t(
        "jevSetup.baseUrlTitle",
        "Base URL of a System One–compatible endpoint"
      ),
      t(
        "jevSetup.baseUrlDesc",
        "Origin, for example https://api.codiv.ai. /v1/systemone is appended; plain http works on localhost."
      ),
    ],
    "key-entry": [
      providerName(state.selectedTransport ?? "typesafe"),
      state.selectedTransport === "openai-decisions"
        ? t(
            "jevSetup.keyEntryNoOpenAiKey",
            "No OpenAI Platform API key found. ChatGPT subscription OAuth is not accepted."
          )
        : `${t("jevSetup.keyEntryNoApiKeyFor", "No API key found for")} ${providerName(
            state.selectedTransport ?? "typesafe"
          )}.`,
    ],
    "provider-id": [
      t("jevSetup.providerIdTitle", "Pi provider id"),
      t(
        "jevSetup.providerIdDesc",
        "The Pi provider whose stored login supplies this endpoint's key, for example openrouter."
      ),
    ],
  } as const;

  const [title, description] = titles[key];

  return [`  ${title}`, `  ${description}`, `  ${rendered}`];
};

export const renderJevProvider = (
  options: JevProviderSubmenuOptions,
  state: JevProviderViewState,
  input: JevProviderInput,
  width: number
): string[] => {
  const { theme } = options;

  const lines = [
    theme.fg("accent", theme.bold(`  ${t("jevSetup.title", "Jev provider")}`)),
    "",
  ];

  if (state.credentials) {
    lines.push(
      `  ${t("jevSetup.credentialLabel", "Credential:")} ${transportLabel(
        state.credentials
      )}`
    );
  } else if (state.selectedTransport) {
    lines.push(
      `  ${t("jevSetup.selectedProviderLabel", "Selected provider:")} ${providerName(
        state.selectedTransport
      )}`
    );
  } else {
    lines.push(
      `  ${t("jevSetup.savedTransportLabel", "Saved transport:")} ${
        options.currentTransport
      }`
    );
  }

  if (state.baseUrl) {
    lines.push(`  ${t("jevSetup.baseUrlLabel", "Base URL:")} ${state.baseUrl}`);
  }

  if (state.providerId) {
    lines.push(
      `  ${t("jevSetup.piProviderLabel", "Pi provider:")} ${state.providerId}`
    );
  }

  if (state.notice) {
    lines.push("", theme.fg("warning", `  ${state.notice}`));
  }

  lines.push("");

  if (state.mode === "resolving") {
    lines.push(
      `  ${t(
        "jevSetup.checkingCredentials",
        "Checking the selected provider credentials…"
      )}`
    );
  } else if (state.mode === "verifying") {
    lines.push(
      `  ${t("jevSetup.verifyingLiveCall", "Verifying with a live Jev call…")}`
    );
  } else if (state.mode === "clearing") {
    lines.push(
      `  ${t(
        "jevSetup.clearingKey",
        "Clearing the selected provider's stored key…"
      )}`
    );
  } else if (
    state.mode === "base-url" ||
    state.mode === "key-entry" ||
    state.mode === "provider-id"
  ) {
    lines.push(...inputLines(state.mode, state, input, width));

    if (state.inputError) {
      lines.push(theme.fg("error", `  ${state.inputError}`));
    }

    lines.push(
      theme.fg(
        "dim",
        `  ${t("jevSetup.inputHint", "Enter: continue · Esc: return")}`
      )
    );
  } else {
    for (const [index, label] of setupLabels(state).entries()) {
      const prefix = index === state.selectedIndex ? "→ " : "  ";
      lines.push(`${prefix}${label}`);
    }
  }

  return lines.map((line) => truncateToWidth(line, width));
};
