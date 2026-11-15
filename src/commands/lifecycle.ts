import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isMarkedSubagent } from "../child-session.ts";
import {
  advisorToolsEnabledRef,
  alwaysOnRef,
  executorRef,
  getPersistedModelRefs,
  setExecutorRef,
} from "../config/state.ts";
import { loadConfig, saveConfig } from "../config/storage.ts";
import { t } from "../i18n.ts";
import { setAdvisorToolsActive } from "./advisor-tools.ts";
import { notify } from "./runtime.ts";
import type { CommandRuntime } from "./types.ts";

export type ActivateAdvisor = (
  args: string,
  ctx: ExtensionContext,
  announce?: boolean
) => Promise<void>;

export const registerCommandLifecycle = (
  runtime: CommandRuntime,
  activateAdvisor: ActivateAdvisor
) => {
  runtime.pi.on("session_start", async (_event, ctx) => {
    runtime.pendingExecutorModelRef = undefined;
    runtime.resetSameModelNotice();

    // A malformed advisor.json or a provider auth failure must not reject a
    // lifecycle handler and break session startup.
    try {
      loadConfig(ctx);

      if (!advisorToolsEnabledRef) {
        setAdvisorToolsActive(runtime.pi, false);
        runtime.updateSameModelNotice(ctx);

        return;
      }

      if (alwaysOnRef) {
        setAdvisorToolsActive(runtime.pi, false);
        await activateAdvisor("", ctx, false);
      } else {
        runtime.updateSameModelNotice(ctx);
      }
    } catch (error) {
      setAdvisorToolsActive(runtime.pi, false);
      const message = error instanceof Error ? error.message : String(error);
      notify(
        ctx,
        `${t("notify.activationFailed.prefix", "Advisor activation failed:")} ${message}`,
        "error"
      );
    }
  });

  runtime.pi.on("model_select", (event, ctx) => {
    if (!runtime.suppressModelSelectionSync) {
      runtime.updateSameModelNotice(ctx, event.model);
    }

    // "restore" replays a stored session model and "cycle" changes the active
    // model without an explicit `/model` choice. Neither should redefine the
    // configured Executor.
    if (
      event.source !== "set" ||
      runtime.suppressModelSelectionSync ||
      isMarkedSubagent()
    ) {
      return;
    }

    const selected = `${event.model.provider}/${event.model.id}`;

    if (!getPersistedModelRefs().executor) {
      return;
    }

    if (!runtime.flowEnabled()) {
      // Defer persistence until `/advisor` succeeds. This keeps ordinary model
      // selection global defaults untouched when the flow is not enabled.
      runtime.pendingExecutorModelRef = selected;

      return;
    }

    runtime.pendingExecutorModelRef = undefined;

    if (selected === executorRef) {
      return;
    }

    const persisted = getPersistedModelRefs();
    setExecutorRef(selected);
    saveConfig(ctx, {
      persistAdvisor: Boolean(persisted.advisor),
      persistExecutor: true,
    });
  });

  runtime.pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("advisor-usage", undefined);
    }

    for (const [controller, token] of runtime.manualConsultations) {
      controller.abort();
      const timer = runtime.manualProgressTimers.get(controller);

      if (timer) {
        clearInterval(timer);
        runtime.manualProgressTimers.delete(controller);
      }

      runtime.scoutStatus.release(ctx, token);
    }

    runtime.scoutStatus.clear(ctx);
    runtime.manualConsultations.clear();
    runtime.manualProgressTimers.clear();
    runtime.manualProgress.clear();
    runtime.herdrActivity.clear();
  });
};
