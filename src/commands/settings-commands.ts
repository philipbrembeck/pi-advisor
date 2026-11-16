import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  advisorActivationRef,
  alwaysOnRef,
  getAdvisorSettings,
  getPersistedModelRefs,
  setAdvisorToolsEnabledRef,
  setAlwaysOnRef,
} from "../config/state.ts";
import { loadConfig, saveConfig } from "../config/storage.ts";
import { t } from "../i18n.ts";
import {
  readJevClassifierKey,
  restoreJevClassifierKey,
  writeJevClassifierKey,
} from "../jev/classifier-key-store.ts";
import { AdvisorSettingsSelector } from "../ui/settings-selector.ts";
import type { AdvisorSettings } from "../ui/types.ts";
import { loadCommandConfig } from "./activation-preparation.ts";
import { reconcileAdvisorToolsAfterSettings } from "./activation-settings.ts";
import { setAdvisorToolsActive } from "./advisor-tools.ts";
import {
  CONTEXT_PRESETS,
  EFFORT_LEVELS,
  getConfiguredModelRefs,
} from "./model-options.ts";
import { notify } from "./runtime.ts";
import { saveAdvisorSettings } from "./settings-persistence.ts";
import type { CommandRuntime } from "./types.ts";

const persistJevSettings = (
  ctx: ExtensionContext,
  settings: AdvisorSettings,
  runtime: CommandRuntime
): boolean => {
  const previous = getAdvisorSettings();

  try {
    saveAdvisorSettings(ctx, settings, { skipOutcomeLogging: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(
      `${t("settingsCmd.saveFailed.prefix", "Could not save Advisor settings:")} ${message}`,
      "error"
    );

    return false;
  }

  try {
    reconcileAdvisorToolsAfterSettings(runtime, ctx, previous);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(
      `${t(
        "settingsCmd.refreshFailed.prefix",
        "Advisor settings were saved, but the status refresh failed:"
      )} ${message}`,
      "warning"
    );
  }

  return true;
};

export const registerSettingsCommands = (runtime: CommandRuntime) => {
  runtime.pi.registerCommand("advisor-settings", {
    description: "Configure Advisor settings",
    handler: async (_args, ctx) => {
      if (!(loadCommandConfig(ctx) && ctx.hasUI)) {
        return;
      }

      const initial = getAdvisorSettings();
      await ctx.ui.custom<undefined>(
        (tui, theme, keybindings, done) =>
          new AdvisorSettingsSelector({
            effortLevels: EFFORT_LEVELS,
            initial,
            jevSetupDeps: {
              modelRegistry: ctx.modelRegistry,
              persistClassifierKey: writeJevClassifierKey,
              resolveClassifierKey: readJevClassifierKey,
              restoreClassifierKey: restoreJevClassifierKey,
            },
            keybindings,
            modelRefs: getConfiguredModelRefs(ctx),
            onCancel: () => done(undefined),
            onChange: (settings) => {
              const previous = getAdvisorSettings();

              try {
                saveAdvisorSettings(ctx, settings);
                reconcileAdvisorToolsAfterSettings(runtime, ctx, previous);
              } catch (error) {
                const toolsDisabled =
                  previous.advisorToolsEnabled &&
                  settings.advisorToolsEnabled === false;

                if (toolsDisabled) {
                  runtime.noteAdvisorToolsStateChange();
                  setAdvisorToolsEnabledRef(false);
                  setAlwaysOnRef(false);
                  runtime.advisorSessionState.sessionToolsEnabled = false;
                  setAdvisorToolsActive(
                    runtime.pi,
                    false,
                    previous.advisorActivation === "session"
                  );
                  runtime.resetSameModelNotice();
                }

                const message =
                  error instanceof Error ? error.message : String(error);

                ctx.ui.notify(
                  toolsDisabled
                    ? `${t(
                        "settingsCmd.saveFailedToolsDisabled.prefix",
                        "Could not save Advisor settings; tools remain disabled for this session."
                      )} ${message}`
                    : `${t("settingsCmd.saveFailed.prefix", "Could not save Advisor settings:")} ${message}`,
                  "error"
                );
              }
            },
            onJevFilter: (_selection, settings) =>
              persistJevSettings(ctx, settings, runtime),
            onJevProvider: (_selection, settings) =>
              persistJevSettings(ctx, settings, runtime),
            presets: CONTEXT_PRESETS,
            theme,
            tui,
          })
      );
    },
  });

  runtime.pi.registerCommand("advisor-off", {
    description: "Disable Advisor tools; keep the current model",
    handler: (_args, ctx) => {
      runtime.noteAdvisorToolsStateChange();
      runtime.advisorSessionState.sessionToolsEnabled = false;
      setAdvisorToolsActive(
        runtime.pi,
        false,
        advisorActivationRef === "session"
      );
      runtime.resetSameModelNotice();

      try {
        loadConfig(ctx);
      } catch (error) {
        setAdvisorToolsEnabledRef(false);
        setAlwaysOnRef(false);
        const message = error instanceof Error ? error.message : String(error);
        notify(
          ctx,
          `${t(
            "settingsCmd.offReloadFailed.prefix",
            "Advisor tools disabled for this session, but configuration could not be reloaded:"
          )} ${message}`,
          "error"
        );

        return Promise.resolve();
      }

      if (advisorActivationRef === "session") {
        setAdvisorToolsActive(runtime.pi, false, true);
        notify(
          ctx,
          t(
            "settingsCmd.off.session",
            "Advisor tools disabled for this session. Current model unchanged."
          ),
          "info"
        );

        return Promise.resolve();
      }

      const wasAlwaysOn = alwaysOnRef;
      const persisted = getPersistedModelRefs();
      setAdvisorToolsEnabledRef(false);

      if (wasAlwaysOn) {
        setAlwaysOnRef(false);
      }

      try {
        saveConfig(ctx, {
          persistAdvisor: Boolean(persisted.advisor),
          persistExecutor: Boolean(persisted.executor),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notify(
          ctx,
          `${t(
            "settingsCmd.offSaveFailed.prefix",
            "Advisor tools disabled for this session, but the setting could not be saved:"
          )} ${message}`,
          "error"
        );

        return Promise.resolve();
      }

      notify(
        ctx,
        `${t(
          "settingsCmd.off.message",
          "Advisor tools disabled. Current model unchanged."
        )}${
          wasAlwaysOn
            ? ` ${t("settingsCmd.off.alwaysOnTurnedOff", "Always on turned off.")}`
            : ""
        }`,
        "info"
      );

      return Promise.resolve();
    },
  });
};
