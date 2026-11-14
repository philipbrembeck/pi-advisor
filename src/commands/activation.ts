import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  effectiveExecutorEffort,
  effectiveExecutorRef,
  followsSessionExecutor,
  isMarkedSubagent,
} from "../child-session.ts";
import { parseArgs } from "../config/args.ts";
import {
  advisorEffortRef,
  advisorRef,
  advisorToolsEnabledRef,
  contextMaxCharsRef,
  executorEffortRef,
  executorRef,
  setAdvisorEffortRef,
  setAdvisorRef,
  setAdvisorToolsEnabledRef,
  setContextMaxCharsRef,
  setExecutorEffortRef,
  setExecutorRef,
} from "../config/state.ts";
import { saveConfig } from "../config/storage.ts";
import { hasUsableModelAuth } from "../model-auth.ts";
import { sameModelAdvisorDisabled } from "../tools/model-access.ts";
import {
  loadCommandConfig,
  prepareActivationModels,
} from "./activation-preparation.ts";
import { setAdvisorToolsActive } from "./advisor-tools.ts";
import {
  ADVISOR_ACTIVATION_EXPLANATION,
  findConfiguredModel,
  hasAdvisorOverride,
  hasExecutorOverride,
} from "./model-options.ts";
import { notify } from "./runtime.ts";
import type { CommandRuntime, ThinkingLevel } from "./types.ts";

const resolveActivationModels = async (
  runtime: CommandRuntime,
  ctx: ExtensionContext,
  canContinue: () => boolean
) => {
  if (!canContinue()) {
    return { cancelled: true };
  }

  const executor = executorRef
    ? findConfiguredModel(ctx, executorRef)
    : undefined;

  if (executorRef && !executor) {
    return { error: `Executor model not found: ${executorRef}` };
  }

  const advisor = findConfiguredModel(ctx, advisorRef);

  if (!advisor) {
    return {
      error: advisorRef
        ? `Advisor model not found: ${advisorRef}`
        : "Advisor model not configured",
    };
  }

  if (advisor.api !== "pi-virtual") {
    const advisorAuth = await ctx.modelRegistry.getApiKeyAndHeaders(advisor);

    if (!canContinue()) {
      return { cancelled: true };
    }

    if (!(advisorAuth.ok && hasUsableModelAuth(advisorAuth))) {
      return { error: `No API key for Advisor ${advisorRef}` };
    }
  }

  if (
    executor &&
    !isMarkedSubagent() &&
    !(await runtime.setExecutorModel(executor))
  ) {
    return { error: `No API key for Executor ${executorRef}` };
  }

  return {};
};

const restoreActivationRefsIfCurrent = (
  canContinue: () => boolean,
  restoreRefs: () => void
) => {
  if (canContinue()) {
    restoreRefs();
  }
};

const liveRefSnapshot = () => ({
  advisor: advisorRef,
  advisorEffort: advisorEffortRef,
  contextMaxChars: contextMaxCharsRef,
  executor: executorRef,
  executorEffort: executorEffortRef,
});

const persistSuccessfulActivation = (
  ctx: ExtensionContext,
  shouldSave: boolean,
  reenableTools: boolean,
  restoreRefs: () => void
) => {
  if (!shouldSave) {
    return true;
  }

  try {
    saveConfig(ctx, { persistAdvisor: true, persistExecutor: true });
  } catch (saveError) {
    if (!reenableTools) {
      throw saveError;
    }

    setAdvisorToolsEnabledRef(false);
    restoreRefs();

    const message =
      saveError instanceof Error ? saveError.message : String(saveError);

    notify(ctx, `Could not save Advisor activation: ${message}`, "error");

    return false;
  }

  return true;
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

  const { toolAvailabilityRevision } = runtime;

  const canContinue = () =>
    runtime.toolAvailabilityRevision === toolAvailabilityRevision;

  const previous = {
    advisor: advisorRef,
    advisorEffort: advisorEffortRef,
    contextMaxChars: contextMaxCharsRef,
    executor: executorRef,
    executorEffort: executorEffortRef,
  };

  const liveSnapshot = liveRefSnapshot;

  // Restores only refs this activation still owns. A concurrent settings
  // save that replaced a ref keeps its newer value.
  const restoreRefs = (attempted: ReturnType<typeof liveSnapshot>) => {
    if (advisorRef === attempted.advisor) {
      setAdvisorRef(previous.advisor);
    }

    if (advisorEffortRef === attempted.advisorEffort) {
      setAdvisorEffortRef(previous.advisorEffort);
    }

    if (contextMaxCharsRef === attempted.contextMaxChars) {
      setContextMaxCharsRef(previous.contextMaxChars);
    }

    if (executorRef === attempted.executor) {
      setExecutorRef(previous.executor);
    }

    if (executorEffortRef === attempted.executorEffort) {
      setExecutorEffortRef(previous.executorEffort);
    }
  };

  let attempted = liveRefSnapshot();
  const executorOverride = hasExecutorOverride(args);
  const advisorOverride = hasAdvisorOverride(args);
  const argumentError = parseArgs(args);

  if (argumentError) {
    attempted = liveRefSnapshot();
    restoreRefs(attempted);
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
    attempted = liveRefSnapshot();
    restoreActivationRefsIfCurrent(canContinue, () => restoreRefs(attempted));

    return;
  }

  const { cancelled, error } = await resolveActivationModels(
    runtime,
    ctx,
    canContinue
  );

  if (cancelled || !canContinue()) {
    return;
  }

  if (error) {
    restoreRefs(attempted);
    notify(ctx, error, "error");

    return;
  }

  // parseArgs, model picking, and an inactive `/model` selection only mutate
  // in-memory refs. Persist them once both models are known and authenticated,
  // so an unusable model reference is never written to the configuration.
  const reenableTools = !advisorToolsEnabledRef;

  if (reenableTools) {
    setAdvisorToolsEnabledRef(true);
  }

  const shouldSave = Boolean(
    args.trim() ||
    prepared.pickedModels ||
    prepared.pendingExecutor ||
    reenableTools
  );

  if (
    !persistSuccessfulActivation(ctx, shouldSave, reenableTools, () =>
      restoreRefs(liveRefSnapshot())
    )
  ) {
    return;
  }

  // A successful activation has committed the effective Executor. Do not let
  // an older inactive selection override an explicit activation argument on a
  // later attempt.
  runtime.pendingExecutorModelRef = undefined;

  if (executorEffortRef && !isMarkedSubagent()) {
    // SAFETY: executorEffortRef is operator-configured and trusted to name a ThinkingLevel.
    runtime.pi.setThinkingLevel(executorEffortRef as ThinkingLevel);
  }

  setAdvisorToolsActive(runtime.pi, true);

  const activeModel = followsSessionExecutor()
    ? ctx.model
    : findConfiguredModel(ctx, executorRef);

  runtime.updateSameModelNotice(ctx, activeModel);

  if (announce) {
    const activeExecutorRef = effectiveExecutorRef(ctx);
    const activeExecutorEffort = effectiveExecutorEffort(ctx);
    notify(
      ctx,
      `${ADVISOR_ACTIVATION_EXPLANATION}\n\nAdvisor flow ${sameModelAdvisorDisabled(ctx, activeModel) ? "configured" : "ready"} — Executor: ${activeExecutorRef} (thinking: ${activeExecutorEffort || "default"}) · Advisor: ${advisorRef} (thinking: ${advisorEffortRef || "default"})`,
      "info"
    );
  }
};
