import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { clearSessionActivationOverrides } from "../config/session-overrides.ts";
import {
  advisorActivationRef,
  advisorToolsEnabledRef,
  alwaysOnRef,
} from "../config/state.ts";
import { loadConfig } from "../config/storage.ts";
import { t } from "../i18n.ts";
import { setAdvisorToolsActive } from "./advisor-tools.ts";
import { notify } from "./runtime.ts";
import type { CommandRuntime } from "./types.ts";

export type ActivateAdvisor = (
  args: string,
  ctx: ExtensionContext,
  announce?: boolean
) => Promise<boolean>;

export const registerCommandLifecycle = (
  runtime: CommandRuntime,
  activateAdvisor: ActivateAdvisor
) => {
  runtime.pi.on("session_start", async (_event, ctx) => {
    runtime.noteAdvisorToolsStateChange();
    runtime.advisorSessionState.sessionToolsEnabled = false;
    clearSessionActivationOverrides(ctx);
    runtime.resetSameModelNotice();

    // A malformed advisor.json or a provider auth failure must not reject a
    // lifecycle handler and break session startup.
    try {
      loadConfig(ctx);

      if (advisorActivationRef === "session") {
        setAdvisorToolsActive(runtime.pi, false, true);

        return;
      }

      if (!advisorToolsEnabledRef) {
        setAdvisorToolsActive(runtime.pi, false);
        runtime.updateSameModelNotice(ctx);

        return;
      }

      if (alwaysOnRef) {
        const { toolAvailabilityRevision } = runtime;
        const activated = await activateAdvisor("", ctx, false);

        if (
          !activated &&
          runtime.toolAvailabilityRevision === toolAvailabilityRevision
        ) {
          setAdvisorToolsActive(runtime.pi, false);
        }
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

  runtime.pi.on("session_tree", (_event, ctx) => {
    if (advisorActivationRef === "session") {
      runtime.noteAdvisorToolsStateChange();
      setAdvisorToolsActive(
        runtime.pi,
        runtime.advisorSessionState.sessionToolsEnabled,
        true
      );
      runtime.updateSameModelNotice(ctx);
    }
  });

  runtime.pi.on("model_select", (event, ctx) => {
    if (!runtime.suppressModelSelectionSync) {
      runtime.updateSameModelNotice(ctx, event.model);
    }

    // Model selection changes the active Pi session model only. Persisted
    // Executor settings are changed explicitly through `/advisor-models`.
  });

  runtime.pi.on("session_shutdown", (_event, ctx) => {
    runtime.noteAdvisorToolsStateChange();
    clearSessionActivationOverrides(ctx);

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
