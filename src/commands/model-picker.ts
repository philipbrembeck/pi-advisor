import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { t } from "../i18n.ts";
import { SearchableModelSelector } from "../ui/model-selector.ts";
import {
  EXECUTOR_FOLLOWS_SESSION_MODEL,
  FALLBACK_ADVISOR_MODEL_DISABLED,
} from "../ui/types.ts";
import {
  effortChoices,
  getAvailableModelRefs,
  selectedEffort,
} from "./model-options.ts";

export interface AdvisorModelSelection {
  advisor: string;
  advisorEffort: string | undefined;
  advisorFallbackModel: string | undefined;
  executor: string;
  executorEffort: string | undefined;
}

export interface AdvisorModelPickerOptions {
  advisor: string | undefined;
  advisorEffort: string | undefined;
  advisorFallbackModel: string | undefined;
  executor: string | undefined;
  executorEffort: string | undefined;
  selectAdvisor: boolean;
  selectExecutor: boolean;
}

export const selectAdvisorModels = async (
  ctx: ExtensionContext,
  options: AdvisorModelPickerOptions
): Promise<AdvisorModelSelection | undefined> => {
  if (!ctx.hasUI) {
    return undefined;
  }

  const refs = getAvailableModelRefs(ctx);

  if (refs && refs.length === 0) {
    ctx.ui.notify(
      t(
        "notify.noSelectableModels.message",
        "No selectable models are available. Configure a provider with /login or models.json, then retry."
      ),
      "error"
    );

    return undefined;
  }

  const allOptions = [
    ...new Set(
      refs ??
        [options.executor, options.advisor].filter((ref): ref is string =>
          Boolean(ref)
        )
    ),
  ];

  let {
    advisor,
    advisorEffort,
    advisorFallbackModel,
    executor,
    executorEffort,
  } = options;

  if (options.selectExecutor) {
    const selectedExecutor = await ctx.ui.custom<string | undefined>(
      (tui, theme, keybindings, done) =>
        new SearchableModelSelector({
          allOptions: [EXECUTOR_FOLLOWS_SESSION_MODEL, ...allOptions],
          currentOption: executor || EXECUTOR_FOLLOWS_SESSION_MODEL,
          keybindings,
          onCancel: () => done(undefined),
          onSelect: done,
          theme,
          title: t("modelPicker.selectExecutor", "Select Executor Model"),
          tui,
        })
    );

    if (!selectedExecutor) {
      return undefined;
    }

    const selectedExecutorEffort = await ctx.ui.select(
      t(
        "modelPicker.executorEffort",
        "Select Executor Reasoning/Thinking Level"
      ),
      effortChoices(executorEffort)
    );

    if (!selectedExecutorEffort) {
      return undefined;
    }

    executor =
      selectedExecutor === EXECUTOR_FOLLOWS_SESSION_MODEL
        ? ""
        : selectedExecutor;
    executorEffort = selectedEffort(selectedExecutorEffort);
  }

  if (options.selectAdvisor) {
    const selectedAdvisor = await ctx.ui.custom<string | undefined>(
      (tui, theme, keybindings, done) =>
        new SearchableModelSelector({
          allOptions,
          currentOption: advisor || undefined,
          keybindings,
          onCancel: () => done(undefined),
          onSelect: done,
          theme,
          title: t("modelPicker.selectAdvisor", "Select Advisor Model"),
          tui,
        })
    );

    if (!selectedAdvisor) {
      return undefined;
    }

    const selectedAdvisorEffort = await ctx.ui.select(
      t("modelPicker.advisorEffort", "Select Advisor Reasoning/Thinking Level"),
      effortChoices(advisorEffort)
    );

    if (!selectedAdvisorEffort) {
      return undefined;
    }

    advisor = selectedAdvisor;
    advisorEffort = selectedEffort(selectedAdvisorEffort);
  }

  const selectedFallback = await ctx.ui.custom<string | undefined>(
    (tui, theme, keybindings, done) =>
      new SearchableModelSelector({
        allOptions: [
          FALLBACK_ADVISOR_MODEL_DISABLED,
          ...new Set([
            ...allOptions,
            ...(refs || !advisorFallbackModel ? [] : [advisorFallbackModel]),
          ]),
        ],
        currentOption: advisorFallbackModel ?? FALLBACK_ADVISOR_MODEL_DISABLED,
        keybindings,
        onCancel: () => done(undefined),
        onSelect: done,
        theme,
        title: t(
          "modelPicker.selectFallbackAdvisor",
          "Select Fallback Advisor Model (optional)"
        ),
        tui,
      })
  );

  if (selectedFallback === undefined) {
    return undefined;
  }

  advisorFallbackModel =
    selectedFallback === FALLBACK_ADVISOR_MODEL_DISABLED
      ? undefined
      : selectedFallback;

  if (!advisor) {
    return undefined;
  }

  return {
    advisor,
    advisorEffort,
    advisorFallbackModel,
    executor: executor ?? "",
    executorEffort,
  };
};
