import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type getPersistedModelRefs, splitRef } from "../config/state.ts";
import type { ContextPreset } from "../ui/types.ts";

export const DEFAULT_EFFORT_LEVEL = "Default (Model Default)";
export const SELECTED_PREFIX = "✓ ";
export const EFFORT_LEVELS = [
  DEFAULT_EFFORT_LEVEL,
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export const effortChoices = (configured: string | undefined): string[] => {
  const current = configured ?? DEFAULT_EFFORT_LEVEL;
  return [
    `${SELECTED_PREFIX}${current}`,
    ...EFFORT_LEVELS.filter((level) => level !== current),
  ];
};

export const selectedEffort = (choice: string): string | undefined => {
  const effort = choice.startsWith(SELECTED_PREFIX)
    ? choice.slice(SELECTED_PREFIX.length)
    : choice;
  return effort === DEFAULT_EFFORT_LEVEL ? undefined : effort;
};

export const ADVISOR_ACTIVATION_EXPLANATION =
  "The Advisor is a second-opinion model that reviews the Executor's context and returns risks, alternatives, and verification steps without changing files or running tools.";

const ARGUMENT_WHITESPACE = /\s+/;
const hasModelOverride = (args: string, key: "advisor" | "executor") =>
  args
    .trim()
    .split(ARGUMENT_WHITESPACE)
    .some((token) => {
      const [tokenKey, value] = token.split("=");
      return tokenKey === key && Boolean(value);
    });

export const hasExecutorOverride = (args: string) =>
  hasModelOverride(args, "executor");
export const hasAdvisorOverride = (args: string) =>
  hasModelOverride(args, "advisor");

export const CONTEXT_PRESETS: ContextPreset[] = [
  {
    description:
      "No conversation history. The Advisor receives only its standing instructions.",
    label: "0",
    value: 0,
  },
  {
    description: "The most recent 10,000 characters of the current branch.",
    label: "10k",
    value: 10_000,
  },
  {
    description: "The most recent 25,000 characters of the current branch.",
    label: "25k",
    value: 25_000,
  },
  {
    description: "The most recent 100,000 characters of the current branch.",
    label: "100k",
    value: 100_000,
  },
  {
    description: "The most recent 200,000 characters of the current branch.",
    label: "200k",
    value: 200_000,
  },
  {
    description:
      "The complete reconstructed conversation branch. Cost and model context limits apply.",
    label: "ALL",
    value: Number.MAX_SAFE_INTEGER,
  },
];

export const findConfiguredModel = (
  ctx: ExtensionContext,
  ref: string | undefined
) => {
  if (!ref) {
    return;
  }
  const [provider, modelId] = splitRef(ref);
  return ctx.modelRegistry.find(provider, modelId);
};

export const getAvailableModelRefs = (
  ctx: ExtensionContext
): string[] | undefined => {
  if (typeof ctx.modelRegistry.getAvailable !== "function") {
    return undefined;
  }
  return ctx.modelRegistry
    .getAvailable()
    .map((model) => `${model.provider}/${model.id}`);
};

export const isSelectableModel = (
  ctx: ExtensionContext,
  ref: string | undefined,
  availableRefs: Set<string> | undefined
) => {
  if (!ref) {
    return false;
  }
  if (availableRefs) {
    const [provider, modelId] = splitRef(ref);
    return availableRefs.has(`${provider}/${modelId}`);
  }
  return Boolean(findConfiguredModel(ctx, ref));
};

export const getExplicitModelError = (
  ctx: ExtensionContext,
  ref: string | undefined,
  label: "Advisor" | "Executor",
  overridden: boolean,
  availableRefs: Set<string> | undefined
) => {
  if (overridden) {
    if (!ref) {
      return `${label} model not configured`;
    }
    if (!findConfiguredModel(ctx, ref)) {
      return `${label} model not found: ${ref}`;
    }
    if (availableRefs && !isSelectableModel(ctx, ref, availableRefs)) {
      return `${label} model unavailable: ${ref}`;
    }
  }
};

export interface ActivationModelPlan {
  pendingExecutor: string | undefined;
  selectAdvisor: boolean;
  selectExecutor: boolean;
}

export const planActivationModels = (
  ctx: ExtensionContext,
  executor: string | undefined,
  advisor: string | undefined,
  pendingExecutorRef: string | undefined,
  persisted: ReturnType<typeof getPersistedModelRefs>,
  executorOverride: boolean,
  advisorOverride: boolean,
  availableRefs: Set<string> | undefined
): ActivationModelPlan => {
  const pendingExecutor =
    !executorOverride &&
    pendingExecutorRef &&
    isSelectableModel(ctx, pendingExecutorRef, availableRefs)
      ? pendingExecutorRef
      : undefined;
  const executorConfigured =
    executorOverride ||
    Boolean(pendingExecutor) ||
    Boolean(
      persisted.executor && isSelectableModel(ctx, executor, availableRefs)
    );
  const advisorConfigured =
    advisorOverride ||
    Boolean(
      persisted.advisor && isSelectableModel(ctx, advisor, availableRefs)
    );
  return {
    pendingExecutor,
    selectAdvisor: !advisorConfigured,
    selectExecutor: !executorConfigured,
  };
};
