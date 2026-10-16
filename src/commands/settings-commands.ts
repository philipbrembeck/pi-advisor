import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  alwaysOnRef,
  getAdvisorSettings,
  getPersistedModelRefs,
  setAdvisorToolsEnabledRef,
  setAlwaysOnRef,
} from "../config/state.ts";
import { loadConfig, saveConfig } from "../config/storage.ts";
import {
  consumeJevClassifierKey,
  restoreJevClassifierKey,
  writeJevClassifierKey,
} from "../jev/classifier-key-store.ts";
import { AdvisorSettingsSelector } from "../ui/settings-selector.ts";
import type { AdvisorSettings } from "../ui/types.ts";
import { loadCommandConfig } from "./activation-preparation.ts";
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
  try {
    saveAdvisorSettings(ctx, settings, { skipOutcomeLogging: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Could not save Advisor settings: ${message}`, "error");

    return false;
  }

  try {
    setAdvisorToolsActive(runtime.pi, settings.advisorToolsEnabled ?? true);
    runtime.updateSameModelNotice(ctx);
    runtime.updateAdvisorUsageStatus(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(
      `Advisor settings were saved, but the status refresh failed: ${message}`,
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
              resolveClassifierKey: consumeJevClassifierKey,
              restoreClassifierKey: (key) =>
                restoreJevClassifierKey(key ? { key } : {}),
            },
            keybindings,
            modelRefs: getConfiguredModelRefs(ctx),
            onCancel: () => done(undefined),
            onChange: (settings) => {
              const toolsWereEnabled =
                getAdvisorSettings().advisorToolsEnabled ?? true;

              const toolsEnabled = settings.advisorToolsEnabled ?? true;

              try {
                saveAdvisorSettings(ctx, settings);

                if (toolsWereEnabled !== toolsEnabled) {
                  runtime.noteAdvisorToolsStateChange();
                }

                setAdvisorToolsActive(runtime.pi, toolsEnabled);
                runtime.updateSameModelNotice(ctx);
                runtime.updateAdvisorUsageStatus(ctx);
              } catch (error) {
                const toolsDisabled =
                  toolsWereEnabled && settings.advisorToolsEnabled === false;

                if (toolsDisabled) {
                  runtime.noteAdvisorToolsStateChange();
                  setAdvisorToolsEnabledRef(false);
                  setAlwaysOnRef(false);
                  setAdvisorToolsActive(runtime.pi, false);
                  runtime.resetSameModelNotice();
                }

                const message =
                  error instanceof Error ? error.message : String(error);

                ctx.ui.notify(
                  toolsDisabled
                    ? `Could not save Advisor settings; tools remain disabled for this session. ${message}`
                    : `Could not save Advisor settings: ${message}`,
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
    description:
      "Disable model-facing Advisor tools across sessions; keep the current model",
    handler: (_args, ctx) => {
      runtime.noteAdvisorToolsStateChange();
      setAdvisorToolsActive(runtime.pi, false);
      runtime.resetSameModelNotice();

      try {
        loadConfig(ctx);
      } catch (error) {
        setAdvisorToolsEnabledRef(false);
        setAlwaysOnRef(false);
        const message = error instanceof Error ? error.message : String(error);
        notify(
          ctx,
          `Advisor tools disabled for this session, but configuration could not be reloaded: ${message}`,
          "error"
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
          `Advisor tools disabled for this session, but the setting could not be saved: ${message}`,
          "error"
        );

        return Promise.resolve();
      }

      notify(
        ctx,
        `Advisor tools disabled. Current model unchanged.${wasAlwaysOn ? " Always on turned off." : ""}`,
        "info"
      );

      return Promise.resolve();
    },
  });
};
