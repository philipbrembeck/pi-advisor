import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  effectiveExecutorEffort,
  effectiveExecutorRef,
  followsSessionExecutor,
  isMarkedSubagent,
} from "../child-session.ts";
import { parseArgs } from "../config/args.ts";
import { rememberSessionActivationOverrides } from "../config/session-overrides.ts";
import {
  advisorActivationRef,
  advisorEffortRef,
  advisorFallbackModelRef,
  advisorRef,
  advisorToolsEnabledRef,
  contextMaxCharsRef,
  executorEffortRef,
  executorRef,
  setAdvisorEffortRef,
  setAdvisorFallbackModelRef,
  setAdvisorRef,
  setAdvisorToolsEnabledRef,
  setContextMaxCharsRef,
  setExecutorEffortRef,
  setExecutorRef,
} from "../config/state.ts";
import { rebaseConfigBaseline, saveConfig } from "../config/storage.ts";
import { t } from "../i18n.ts";
import { hasUsableModelAuth } from "../model-auth.ts";
import { sameModelAdvisorDisabled } from "../tools/model-access.ts";
import {
  loadCommandConfig,
  prepareActivationModels,
} from "./activation-preparation.ts";
import { setAdvisorToolsActive } from "./advisor-tools.ts";
import {
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
    return {
      error: `${t("activation.executorNotFound.prefix", "Executor model not found:")} ${executorRef}`,
    };
  }

  const advisor = findConfiguredModel(ctx, advisorRef);

  if (!advisor) {
    return {
      error: advisorRef
        ? `${t("activation.advisorNotFound.prefix", "Advisor model not found:")} ${advisorRef}`
        : t("activation.advisorNotConfigured", "Advisor model not configured"),
    };
  }

  if (advisor.api !== "pi-virtual") {
    const advisorAuth = await ctx.modelRegistry.getApiKeyAndHeaders(advisor);

    if (!canContinue()) {
      return { cancelled: true };
    }

    if (!(advisorAuth.ok && hasUsableModelAuth(advisorAuth))) {
      return {
        error: `${t("activation.noAdvisorApiKey.prefix", "No API key for Advisor")} ${advisorRef}`,
      };
    }
  }

  if (
    executor &&
    !isMarkedSubagent() &&
    !(await runtime.setExecutorModel(executor))
  ) {
    return {
      error: `${t("activation.noExecutorApiKey.prefix", "No API key for Executor")} ${executorRef}`,
    };
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
  advisorFallbackModel: advisorFallbackModelRef,
  contextMaxChars: contextMaxCharsRef,
  executor: executorRef,
  executorEffort: executorEffortRef,
});

const restoreActivationRefs = (
  previous: ReturnType<typeof liveRefSnapshot>,
  attempted: ReturnType<typeof liveRefSnapshot>
) => {
  if (advisorRef === attempted.advisor) {
    setAdvisorRef(previous.advisor);
  }

  if (advisorEffortRef === attempted.advisorEffort) {
    setAdvisorEffortRef(previous.advisorEffort);
  }

  if (advisorFallbackModelRef === attempted.advisorFallbackModel) {
    setAdvisorFallbackModelRef(previous.advisorFallbackModel);
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

    notify(
      ctx,
      `${t(
        "activation.saveFailed.prefix",
        "Could not save Advisor activation:"
      )} ${message}`,
      "error"
    );

    return false;
  }

  return true;
};

const announceActivation = (
  ctx: ExtensionContext,
  activeModel: { id: string; provider: string } | undefined
) => {
  const activeExecutorRef = effectiveExecutorRef(ctx);
  const activeExecutorEffort = effectiveExecutorEffort(ctx);

  notify(
    ctx,
    `${t(
      "activation.explanation",
      "The Advisor is a second-opinion model that reviews the Executor's context and returns risks, alternatives, and verification steps without changing files or running tools."
    )}\n\n${t("activation.flow", "Advisor flow")} ${
      sameModelAdvisorDisabled(ctx, activeModel)
        ? t("activation.flowConfigured", "configured")
        : t("activation.flowReady", "ready")
    } — Executor: ${activeExecutorRef} (thinking: ${activeExecutorEffort || "default"}) · Advisor: ${advisorRef} (thinking: ${advisorEffortRef || "default"})`,
    "info"
  );
};

export const activateAdvisor = async (
  runtime: CommandRuntime,
  args: string,
  ctx: ExtensionContext,
  announce = true
): Promise<boolean> => {
  if (!loadCommandConfig(ctx)) {
    return false;
  }

  const { toolAvailabilityRevision } = runtime;

  const canContinue = () =>
    runtime.toolAvailabilityRevision === toolAvailabilityRevision;

  const previous = liveRefSnapshot();

  const restoreRefs = (attempted: ReturnType<typeof liveRefSnapshot>) =>
    restoreActivationRefs(previous, attempted);

  let attempted = liveRefSnapshot();
  const executorOverride = hasExecutorOverride(args);
  const advisorOverride = hasAdvisorOverride(args);
  const argumentError = parseArgs(args);

  if (argumentError) {
    attempted = liveRefSnapshot();
    restoreRefs(attempted);
    notify(ctx, argumentError, "error");

    return false;
  }

  const prepared = await prepareActivationModels(
    runtime,
    ctx,
    announce,
    executorOverride,
    advisorOverride,
    canContinue
  );

  if (!prepared) {
    attempted = liveRefSnapshot();
    restoreActivationRefsIfCurrent(canContinue, () => restoreRefs(attempted));

    return false;
  }

  const { cancelled, error } = await resolveActivationModels(
    runtime,
    ctx,
    canContinue
  );

  if (cancelled || !canContinue()) {
    return false;
  }

  if (error) {
    restoreRefs(attempted);
    notify(ctx, error, "error");

    return false;
  }

  // Persist model changes only after both models are known and authenticated.
  const sessionScoped = advisorActivationRef === "session";
  const reenableTools = !sessionScoped && !advisorToolsEnabledRef;

  if (reenableTools) {
    setAdvisorToolsEnabledRef(true);
  }

  const shouldSave =
    !sessionScoped &&
    Boolean(args.trim() || prepared.pickedModels || reenableTools);

  if (
    !persistSuccessfulActivation(ctx, shouldSave, reenableTools, () =>
      restoreRefs(liveRefSnapshot())
    )
  ) {
    return false;
  }

  if (executorEffortRef && !isMarkedSubagent()) {
    // SAFETY: executorEffortRef is operator-configured and trusted to name a ThinkingLevel.
    runtime.pi.setThinkingLevel(executorEffortRef as ThinkingLevel);
  }

  if (sessionScoped) {
    rememberSessionActivationOverrides(ctx, previous, liveRefSnapshot());
    rebaseConfigBaseline();
    runtime.advisorSessionState.sessionToolsEnabled = true;
  }

  setAdvisorToolsActive(runtime.pi, true, sessionScoped);

  const activeModel = followsSessionExecutor()
    ? ctx.model
    : findConfiguredModel(ctx, executorRef);

  runtime.updateSameModelNotice(ctx, activeModel);

  if (announce) {
    announceActivation(ctx, activeModel);
  }

  return true;
};
