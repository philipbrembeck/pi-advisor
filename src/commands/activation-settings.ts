import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { getAdvisorSettings } from "../config/state.ts";
import {
  enableAdvisorConfigurationTool,
  setAdvisorToolsActive,
} from "./advisor-tools.ts";
import type { CommandRuntime } from "./types.ts";

export const reconcileAdvisorToolsAfterSettings = (
  runtime: CommandRuntime,
  ctx: ExtensionContext,
  previous: ReturnType<typeof getAdvisorSettings>,
  refreshPersistentTools = true
) => {
  const next = getAdvisorSettings();
  const modeChanged = previous.advisorActivation !== next.advisorActivation;

  const preferenceChanged =
    previous.advisorToolsEnabled !== next.advisorToolsEnabled;

  const sessionScoped = next.advisorActivation === "session";

  const enabledByAlwaysOn =
    !previous.alwaysOn &&
    next.alwaysOn &&
    !previous.advisorToolsEnabled &&
    next.advisorToolsEnabled;

  const persistentOutOfSync =
    !sessionScoped && runtime.flowEnabled() !== next.advisorToolsEnabled;

  if (
    modeChanged ||
    preferenceChanged ||
    (!refreshPersistentTools && persistentOutOfSync)
  ) {
    runtime.noteAdvisorToolsStateChange();
  }

  let enabled = next.advisorToolsEnabled;

  if (sessionScoped) {
    if (modeChanged) {
      runtime.advisorSessionState.sessionToolsEnabled = runtime.flowEnabled();
    } else if (preferenceChanged && !enabledByAlwaysOn) {
      runtime.advisorSessionState.sessionToolsEnabled = enabled;
    }

    enabled = runtime.advisorSessionState.sessionToolsEnabled;
    setAdvisorToolsActive(runtime.pi, enabled, true);
  } else {
    if (modeChanged) {
      enableAdvisorConfigurationTool(runtime.pi);
    }

    if (
      refreshPersistentTools ||
      modeChanged ||
      preferenceChanged ||
      persistentOutOfSync
    ) {
      setAdvisorToolsActive(runtime.pi, enabled);
    }
  }

  if (!enabled) {
    runtime.resetSameModelNotice();
  }

  runtime.updateSameModelNotice(ctx);
  runtime.updateAdvisorUsageStatus(ctx);
};
