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
import { saveConfig } from "../config/storage.ts";
import { activateAdvisor } from "./activation.ts";
import { loadCommandConfig } from "./activation-preparation.ts";
import { selectAdvisorModels } from "./model-picker.ts";
import type { CommandRuntime } from "./types.ts";

export const registerModelCommands = (runtime: CommandRuntime) => {
  runtime.pi.registerCommand("advisor", {
    description:
      "Enable the Executor/Advisor flow and switch to the configured or explicitly selected Executor model; accepts contextMaxChars=N",
    handler: (args, ctx) => activateAdvisor(runtime, args, ctx),
  });

  runtime.pi.registerCommand("advisor-models", {
    description:
      "Select and persist the Executor and Advisor models with reasoning levels",
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
        executor:
          runtime.pendingExecutorModelRef ??
          (persisted.executor ? executorRef : ""),
        executorEffort: executorEffortRef,
        selectAdvisor: true,
        selectExecutor: true,
      });
      if (!selection) {
        return;
      }

      setExecutorRef(selection.executor);
      setAdvisorRef(selection.advisor);
      setExecutorEffortRef(selection.executorEffort);
      setAdvisorEffortRef(selection.advisorEffort);

      const path = saveConfig(ctx, {
        persistAdvisor: true,
        persistExecutor: true,
      });
      runtime.pendingExecutorModelRef = undefined;
      ctx.ui.notify(
        `Saved Executor + Advisor configurations to ${path}`,
        "info"
      );
    },
  });
};
