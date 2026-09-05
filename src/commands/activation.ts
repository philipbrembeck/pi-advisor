import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseArgs } from "../config/args.js";
import {
  advisorEffortRef,
  advisorRef,
  contextMaxCharsRef,
  executorEffortRef,
  executorRef,
  setAdvisorEffortRef,
  setAdvisorRef,
  setContextMaxCharsRef,
  setExecutorEffortRef,
  setExecutorRef,
} from "../config/state.js";
import { saveConfig } from "../config/storage.js";
import {
  loadCommandConfig,
  prepareActivationModels,
} from "./activation-preparation.js";
import {
  ADVISOR_ACTIVATION_EXPLANATION,
  findConfiguredModel,
  hasAdvisorOverride,
  hasExecutorOverride,
} from "./model-options.js";
import { notify } from "./runtime.js";
import type { CommandRuntime, ThinkingLevel } from "./types.js";

const resolveActivationModels = async (
  runtime: CommandRuntime,
  ctx: ExtensionContext
) => {
  const executor = findConfiguredModel(ctx, executorRef);
  if (!executor) {
    return {
      error: executorRef
        ? `Executor model not found: ${executorRef}`
        : "Executor model not configured",
    };
  }
  const advisor = findConfiguredModel(ctx, advisorRef);
  if (!advisor) {
    return {
      error: advisorRef
        ? `Advisor model not found: ${advisorRef}`
        : "Advisor model not configured",
    };
  }
  const advisorAuth = await ctx.modelRegistry.getApiKeyAndHeaders(advisor);
  if (!(advisorAuth.ok && advisorAuth.apiKey)) {
    return { error: `No API key for Advisor ${advisorRef}` };
  }
  if (!(await runtime.setExecutorModel(executor))) {
    return { error: `No API key for Executor ${executorRef}` };
  }
  return {};
};

export const activateAdvisor = async (
  runtime: CommandRuntime,
  args: string,
  ctx: ExtensionContext,
  announce = true
) => {
  if (!loadCommandConfig(ctx)) {
    return;
  }
  const previous = {
    advisor: advisorRef,
    advisorEffort: advisorEffortRef,
    contextMaxChars: contextMaxCharsRef,
    executor: executorRef,
    executorEffort: executorEffortRef,
  };
  const restoreRefs = () => {
    setAdvisorRef(previous.advisor);
    setAdvisorEffortRef(previous.advisorEffort);
    setContextMaxCharsRef(previous.contextMaxChars);
    setExecutorRef(previous.executor);
    setExecutorEffortRef(previous.executorEffort);
  };
  const executorOverride = hasExecutorOverride(args);
  const advisorOverride = hasAdvisorOverride(args);
  const argumentError = parseArgs(args);
  if (argumentError) {
    restoreRefs();
    notify(ctx, argumentError, "error");
    return;
  }

  const prepared = await prepareActivationModels(
    runtime,
    ctx,
    announce,
    executorOverride,
    advisorOverride
  );
  if (!prepared) {
    restoreRefs();
    return;
  }
  const { error } = await resolveActivationModels(runtime, ctx);
  if (error) {
    restoreRefs();
    notify(ctx, error, "error");
    return;
  }
  // parseArgs, model picking, and an inactive `/model` selection only mutate
  // in-memory refs. Persist them once both models are known and authenticated,
  // so an unusable model reference is never written to the configuration.
  if (args.trim() || prepared.pickedModels || prepared.pendingExecutor) {
    saveConfig(ctx, { persistAdvisor: true, persistExecutor: true });
  }
  // A successful activation has committed the effective Executor. Do not let
  // an older inactive selection override an explicit activation argument on a
  // later attempt.
  runtime.pendingExecutorModelRef = undefined;
  if (executorEffortRef) {
    runtime.pi.setThinkingLevel(executorEffortRef as ThinkingLevel);
  }
  if (!runtime.flowEnabled()) {
    runtime.pi.setActiveTools([
      ...runtime.pi.getActiveTools(),
      "ask_advisor",
      "record_advisor_outcome",
    ]);
  }
  if (announce) {
    notify(
      ctx,
      `${ADVISOR_ACTIVATION_EXPLANATION}\n\nAdvisor flow ready — Executor: ${executorRef} (thinking: ${executorEffortRef || "default"}) · Advisor: ${advisorRef} (thinking: ${advisorEffortRef || "default"})`,
      "info"
    );
  }
};
