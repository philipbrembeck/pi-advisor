import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { executorEffortRef, executorRef } from "./config/state.ts";

export const isMarkedSubagent = () => process.env.PI_SUBAGENT_CHILD === "1";

export const effectiveExecutorRef = (ctx: ExtensionContext) => {
  if (isMarkedSubagent() && ctx.model) {
    return `${ctx.model.provider}/${ctx.model.id}`;
  }
  return executorRef;
};

export const effectiveExecutorEffort = (ctx: ExtensionContext) =>
  isMarkedSubagent() ? ctx.thinkingLevel : executorEffortRef;
