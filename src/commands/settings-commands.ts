import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  alwaysOnRef,
  getAdvisorSettings,
  getPersistedModelRefs,
  setAlwaysOnRef,
} from "../config/state.ts";
import { saveConfig } from "../config/storage.ts";
import {
  resolveJevTransport,
  resolveJevTransportFor,
  resolveTypesafeCompatibleCredentials,
} from "../jev/transport.ts";
import { AdvisorSettingsSelector } from "../ui/settings-selector.ts";
import type { AdvisorSettings } from "../ui/types.ts";
import { loadCommandConfig } from "./activation-preparation.ts";
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
              resolveEndpoint: (options) =>
                resolveTypesafeCompatibleCredentials(options, ctx),
              resolveTransport: (transport) =>
                transport
                  ? resolveJevTransportFor(transport, ctx)
                  : resolveJevTransport(ctx),
            },
            keybindings,
            modelRefs: getConfiguredModelRefs(ctx),
            onCancel: () => done(undefined),
            onChange: (settings) => {
              try {
                saveAdvisorSettings(ctx, settings);
                runtime.updateSameModelNotice(ctx);
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
      runtime.resetSameModelNotice();
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
