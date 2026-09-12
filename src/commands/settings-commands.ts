import {
  alwaysOnRef,
  getAdvisorSettings,
  getPersistedModelRefs,
  setAlwaysOnRef,
} from "../config/state.ts";
import { saveConfig } from "../config/storage.ts";
import { AdvisorSettingsSelector } from "../ui/settings-selector.ts";
import { loadCommandConfig } from "./activation-preparation.ts";
import { CONTEXT_PRESETS, EFFORT_LEVELS } from "./model-options.ts";
import { notify } from "./runtime.ts";
import { saveAdvisorSettings } from "./settings-persistence.ts";
import type { CommandRuntime } from "./types.ts";

export const registerSettingsCommands = (runtime: CommandRuntime) => {
  runtime.pi.registerCommand("advisor-settings", {
    description: "Configure Advisor settings",
    handler: async (_args, ctx) => {
      if (!(loadCommandConfig(ctx) && ctx.hasUI)) {
        return;
      }

      const initial = getAdvisorSettings();
      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) =>
          new AdvisorSettingsSelector({
            effortLevels: EFFORT_LEVELS,
            initial,
            onCancel: () => done(),
            onChange: (settings) => {
              try {
                saveAdvisorSettings(ctx, settings);
                runtime.updateAdvisorUsageStatus(ctx);
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);
                ctx.ui.notify(
                  `Could not save Advisor settings: ${message}`,
                  "error"
                );
              }
            },
            presets: CONTEXT_PRESETS,
            theme,
            tui,
          })
      );
    },
  });

  runtime.pi.registerCommand("advisor-off", {
    description: "Disable on-demand Advisor calls; keep the current model",
    handler: (_args, ctx) => {
      runtime.pi.setActiveTools(
        runtime.pi
          .getActiveTools()
          .filter(
            (name) =>
              name !== "ask_advisor" && name !== "record_advisor_outcome"
          )
      );
      // Leaving alwaysOn set would silently reactivate the flow next session.
      const wasAlwaysOn = alwaysOnRef;
      if (wasAlwaysOn) {
        const persisted = getPersistedModelRefs();
        setAlwaysOnRef(false);
        saveConfig(ctx, {
          persistAdvisor: Boolean(persisted.advisor),
          persistExecutor: Boolean(persisted.executor),
        });
      }
      notify(
        ctx,
        `Advisor flow disabled. Current model unchanged.${wasAlwaysOn ? " Always on turned off." : ""}`,
        "info"
      );
      return Promise.resolve();
    },
  });
};
