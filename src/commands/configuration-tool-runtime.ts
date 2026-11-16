import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { getAdvisorSettings } from "../config/state.ts";
import { reconcileAdvisorToolsAfterSettings } from "./activation-settings.ts";
import type { CommandRuntime } from "./types.ts";

export const applyAdvisorConfigRuntimeSettings = (
  runtime: CommandRuntime,
  ctx: ExtensionContext,
  previous: ReturnType<typeof getAdvisorSettings>
) => {
  reconcileAdvisorToolsAfterSettings(runtime, ctx, previous, false);
};

export const cancelledAdvisorConfigResult = (message: string) => ({
  content: [{ text: message, type: "text" as const }],
  details: { action: "update", applied: false, cancelled: true },
});

export const unchangedAdvisorConfigResult = (message: string) => ({
  content: [{ text: message, type: "text" as const }],
  details: { action: "update", applied: false, unchanged: true },
});
