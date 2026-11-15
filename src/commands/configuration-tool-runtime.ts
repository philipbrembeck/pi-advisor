import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { getAdvisorSettings } from "../config/state.ts";
import { setAdvisorToolsActive } from "./advisor-tools.ts";
import type { CommandRuntime } from "./types.ts";

export const applyAdvisorConfigRuntimeSettings = (
  runtime: CommandRuntime,
  ctx: ExtensionContext,
  previous: ReturnType<typeof getAdvisorSettings>
) => {
  const next = getAdvisorSettings();
  const shouldEnable = next.advisorToolsEnabled ?? true;
  const toolsAreActive = runtime.pi.getActiveTools().includes("ask_advisor");

  if (
    previous.advisorToolsEnabled !== next.advisorToolsEnabled ||
    toolsAreActive !== shouldEnable
  ) {
    runtime.noteAdvisorToolsStateChange();
    setAdvisorToolsActive(runtime.pi, shouldEnable);

    if (!shouldEnable) {
      runtime.resetSameModelNotice();
    }
  }

  runtime.updateSameModelNotice(ctx);
  runtime.updateAdvisorUsageStatus(ctx);
};

export const cancelledAdvisorConfigResult = (message: string) => ({
  content: [{ text: message, type: "text" as const }],
  details: { action: "update", applied: false, cancelled: true },
});

export const unchangedAdvisorConfigResult = (message: string) => ({
  content: [{ text: message, type: "text" as const }],
  details: { action: "update", applied: false, unchanged: true },
});
