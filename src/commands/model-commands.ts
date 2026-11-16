import { clearSessionActivationOverrides } from "../config/session-overrides.ts";
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
import { saveConfig } from "../config/storage.ts";
import { t } from "../i18n.ts";
import { loadCommandConfig } from "./activation-preparation.ts";
import { activateAdvisor } from "./activation.ts";
import { selectAdvisorModels } from "./model-picker.ts";
import type { CommandRuntime } from "./types.ts";

const MODEL_SETTINGS = [
  "advisor",
  "advisorEffort",
  "advisorFallbackModel",
  "executor",
  "executorEffort",
] as const;

export const registerModelCommands = (runtime: CommandRuntime) => {
  runtime.pi.registerCommand("advisor", {
    description:
      "Enable the Executor/Advisor flow and switch to the configured or explicitly selected Executor model; accepts contextMaxChars=N",
    handler: (args, ctx) => activateAdvisor(runtime, args, ctx),
  });

  runtime.pi.registerCommand("advisor-models", {
    description:
      "Select and persist the Executor, Advisor, and optional fallback models with reasoning levels",
    handler: async (_args, ctx) => {
      if (!(loadCommandConfig(ctx) && ctx.hasUI)) {
        return;
      }

      // When `/model` was used before activation, show that session choice as
      // the Executor's current option instead of making the persisted Executor
      // look like the active selection.
      const persisted = getPersistedModelRefs();

      const selection = await selectAdvisorModels(ctx, {
        advisor: persisted.advisor ? advisorRef : "",
        advisorEffort: advisorEffortRef,
        advisorFallbackModel: advisorFallbackModelRef,
        executor: persisted.executor ? executorRef : "",
        executorEffort: executorEffortRef,
        selectAdvisor: true,
        selectExecutor: true,
      });

      if (!selection) {
        return;
      }

      setExecutorRef(selection.executor);
      setAdvisorRef(selection.advisor);
      setAdvisorFallbackModelRef(selection.advisorFallbackModel);
      setExecutorEffortRef(selection.executorEffort);
      setAdvisorEffortRef(selection.advisorEffort);

      const sessionScoped = advisorActivationRef === "session";

      const path = saveConfig(ctx, {
        forceKeys: sessionScoped ? MODEL_SETTINGS : undefined,
        persistAdvisor: true,
        persistExecutor: true,
      });

      if (sessionScoped) {
        clearSessionActivationOverrides(ctx, MODEL_SETTINGS);
      }

      runtime.updateSameModelNotice(ctx);
      ctx.ui.notify(
        `${t("notify.modelsSaved.prefix", "Saved Executor + Advisor configurations to")} ${path}`,
        "info"
      );
    },
  });
};
