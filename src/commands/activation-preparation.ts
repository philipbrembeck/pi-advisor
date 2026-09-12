import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  advisorEffortRef,
  advisorRef,
  executorEffortRef,
  executorRef,
  getPersistedModelRefs,
  setAdvisorEffortRef,
  setAdvisorRef,
  setExecutorEffortRef,
  setExecutorRef,
} from "../config/state.ts";
import { loadConfig } from "../config/storage.ts";
import {
  getAvailableModelRefs,
  getExplicitModelError,
  planActivationModels,
} from "./model-options.ts";
import { selectAdvisorModels } from "./model-picker.ts";
import { notify } from "./runtime.ts";
import type { CommandRuntime } from "./types.ts";

export interface PreparedActivationModels {
  pendingExecutor?: string;
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
      `Advisor command could not load configuration: ${message} Fix advisor.json and retry.`,
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
  advisorOverride: boolean
): Promise<PreparedActivationModels | undefined> => {
  const persisted = getPersistedModelRefs();
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
    runtime.pendingExecutorModelRef,
    persisted,
    executorOverride,
    advisorOverride,
    availableRefSet
  );
  setExecutorRef(plan.pendingExecutor ?? executorRef);
  if (!(plan.selectExecutor || plan.selectAdvisor)) {
    return { pendingExecutor: plan.pendingExecutor, pickedModels: false };
  }

  // Always-on startup cannot open an interactive picker, so it leaves the
  // flow disabled until the user selects both models with `/advisor`.
  if (!announce) {
    notify(
      ctx,
      "Advisor models are not configured or available. Run /advisor to choose them.",
      "error"
    );
    return;
  }
  const selection = await selectAdvisorModels(ctx, {
    advisor: advisorOverride || persisted.advisor ? advisorRef : "",
    advisorEffort: advisorEffortRef,
    executor:
      executorOverride || plan.pendingExecutor || persisted.executor
        ? executorRef
        : "",
    executorEffort: executorEffortRef,
    selectAdvisor: plan.selectAdvisor,
    selectExecutor: plan.selectExecutor,
  });
  if (!selection) {
    return;
  }
  setAdvisorRef(selection.advisor);
  setAdvisorEffortRef(selection.advisorEffort);
  setExecutorRef(selection.executor);
  setExecutorEffortRef(selection.executorEffort);
  return { pendingExecutor: plan.pendingExecutor, pickedModels: true };
};
