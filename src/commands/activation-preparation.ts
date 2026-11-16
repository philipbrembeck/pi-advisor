import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { getSessionActivationOverrides } from "../config/session-overrides.ts";
import {
  advisorActivationRef,
  advisorEffortRef,
  advisorFallbackModelRef,
  advisorRef,
  executorEffortRef,
  executorRef,
  getPersistedModelRefs,
  setAdvisorEffortRef,
  setAdvisorFallbackModelRef,
  setAdvisorRef,
  setExecutorEffortRef,
  setExecutorRef,
} from "../config/state.ts";
import { loadConfig } from "../config/storage.ts";
import { t } from "../i18n.ts";
import {
  getAvailableModelRefs,
  getExplicitModelError,
  planActivationModels,
} from "./model-options.ts";
import { selectAdvisorModels } from "./model-picker.ts";
import { notify } from "./runtime.ts";
import type { CommandRuntime } from "./types.ts";

export interface PreparedActivationModels {
  pickedModels: boolean;
}

export const loadCommandConfig = (ctx: ExtensionContext) => {
  try {
    loadConfig(ctx);

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify(
      ctx,
      `${t(
        "notify.configLoadFailed.prefix",
        "Advisor command could not load configuration:"
      )} ${message} ${t("notify.configLoadFailed.suffix", "Fix advisor.json and retry.")}`,
      "error"
    );

    return false;
  }
};

export const prepareActivationModels = async (
  runtime: CommandRuntime,
  ctx: ExtensionContext,
  announce: boolean,
  executorOverride: boolean,
  advisorOverride: boolean,
  canContinue: () => boolean
): Promise<PreparedActivationModels | undefined> => {
  const saved = getPersistedModelRefs();

  const overrides =
    advisorActivationRef === "session"
      ? getSessionActivationOverrides(ctx)
      : undefined;

  const persisted = {
    advisor:
      overrides && Object.hasOwn(overrides, "advisor")
        ? advisorRef || undefined
        : saved.advisor,
    executor:
      overrides && Object.hasOwn(overrides, "executor")
        ? executorRef || undefined
        : saved.executor,
  };

  const availableRefs = getAvailableModelRefs(ctx);
  const availableRefSet = availableRefs ? new Set(availableRefs) : undefined;

  const explicitError =
    getExplicitModelError(
      ctx,
      executorRef,
      "Executor",
      executorOverride,
      availableRefSet
    ) ??
    getExplicitModelError(
      ctx,
      advisorRef,
      "Advisor",
      advisorOverride,
      availableRefSet
    );

  if (explicitError) {
    notify(ctx, explicitError, "error");

    return;
  }

  const plan = planActivationModels(
    ctx,
    executorRef,
    advisorRef,
    persisted,
    executorOverride,
    advisorOverride,
    availableRefSet
  );

  if (!(plan.selectExecutor || plan.selectAdvisor)) {
    return { pickedModels: false };
  }

  // Always-on startup cannot open an interactive picker, so it leaves the
  // flow disabled until the user selects both models with `/advisor`.
  if (!announce) {
    notify(
      ctx,
      t(
        "notify.modelsNotConfigured.message",
        "Advisor models are not configured or available. Run /advisor to choose them."
      ),
      "error"
    );

    return;
  }

  const selection = await selectAdvisorModels(ctx, {
    canContinue,
    advisor: advisorOverride || persisted.advisor ? advisorRef : "",
    advisorEffort: advisorEffortRef,
    advisorFallbackModel: advisorFallbackModelRef,
    executor: executorOverride || persisted.executor ? executorRef : "",
    executorEffort: executorEffortRef,
    selectAdvisor: plan.selectAdvisor,
    selectExecutor: plan.selectExecutor,
  }).catch((error) => {
    if (!canContinue()) {
      return undefined;
    }

    throw error;
  });

  if (!selection || !canContinue()) {
    return;
  }

  setAdvisorRef(selection.advisor);
  setAdvisorFallbackModelRef(selection.advisorFallbackModel);
  setAdvisorEffortRef(selection.advisorEffort);
  setExecutorRef(selection.executor);
  setExecutorEffortRef(selection.executorEffort);

  return { pickedModels: true };
};
