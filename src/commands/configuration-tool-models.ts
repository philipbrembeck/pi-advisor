import type { AdvisorConfig } from "../config/types.ts";
import type { RecordValue } from "../content-utils.ts";
import type { AdvisorConfigPatch } from "./configuration-tool-policy.ts";
import { sameConfigValue } from "./configuration-tool-preview.ts";
import { getConfiguredModelRefs } from "./model-options.ts";
import { selectAdvisorModels } from "./model-picker.ts";
import type {
  AdvisorModelPickerOptions,
  AdvisorModelSelection,
} from "./model-picker.ts";

const MODEL_KEYS = [
  "advisor",
  "advisorEffort",
  "advisorFallbackModel",
  "executor",
  "executorEffort",
] as const satisfies readonly (keyof AdvisorConfig)[];

type ModelKey = (typeof MODEL_KEYS)[number];

type ModelRefKey = "advisor" | "advisorFallbackModel" | "executor";

const MODEL_REF_KEYS: readonly ModelRefKey[] = [
  "advisor",
  "advisorFallbackModel",
  "executor",
];

export type SelectAdvisorModels = typeof selectAdvisorModels;

const isModelChange = (changes: AdvisorConfigPatch) =>
  MODEL_KEYS.some((key) => Object.hasOwn(changes, key));

const validateRequestedModels = (
  changes: AdvisorConfigPatch,
  modelRefs: string[]
) => {
  for (const key of MODEL_REF_KEYS) {
    const requested = changes[key];

    if (
      requested !== null &&
      requested !== undefined &&
      !modelRefs.includes(requested)
    ) {
      throw new Error(
        `${key} must name an available provider/model. Choose it from /advisor-models or use the model picker opened by advisor_config.`
      );
    }
  }
};

const pickerOptions = (
  changes: AdvisorConfigPatch,
  before: AdvisorConfig
): AdvisorModelPickerOptions => ({
  advisor: changes.advisor ?? before.advisor,
  advisorEffort:
    changes.advisorEffort === null
      ? undefined
      : (changes.advisorEffort ?? before.advisorEffort),
  advisorFallbackModel:
    changes.advisorFallbackModel === null
      ? undefined
      : (changes.advisorFallbackModel ?? before.advisorFallbackModel),
  executor:
    changes.executor === null ? "" : (changes.executor ?? before.executor),
  executorEffort:
    changes.executorEffort === null
      ? undefined
      : (changes.executorEffort ?? before.executorEffort),
  selectAdvisor:
    Object.hasOwn(changes, "advisor") ||
    Object.hasOwn(changes, "advisorEffort") ||
    !before.advisor,
  selectExecutor:
    Object.hasOwn(changes, "executor") ||
    Object.hasOwn(changes, "executorEffort"),
});

const selectedModelChanges = (
  changes: AdvisorConfigPatch,
  selection: AdvisorModelSelection,
  persisted: RecordValue
): AdvisorConfigPatch => {
  const selected = {
    advisor: selection.advisor,
    advisorEffort: selection.advisorEffort ?? null,
    advisorFallbackModel: selection.advisorFallbackModel ?? null,
    executor: selection.executor || null,
    executorEffort: selection.executorEffort ?? null,
  } satisfies Record<ModelKey, string | null>;

  const resolved: Partial<Record<ModelKey, string | null>> = {};

  for (const key of MODEL_KEYS) {
    const persistedValue = persisted[key] ?? null;

    if (!sameConfigValue(selected[key], persistedValue)) {
      resolved[key] = selected[key];
    }
  }

  const {
    advisor: _requestedAdvisor,
    advisorEffort: _requestedAdvisorEffort,
    advisorFallbackModel: _requestedFallback,
    executor: _requestedExecutor,
    executorEffort: _requestedExecutorEffort,
    ...otherChanges
  } = changes;

  return { ...otherChanges, ...resolved };
};

export const resolveModelChanges = async (
  ctx: Parameters<typeof selectAdvisorModels>[0],
  changes: AdvisorConfigPatch,
  before: AdvisorConfig,
  persisted: RecordValue,
  selectModels: SelectAdvisorModels = selectAdvisorModels
): Promise<AdvisorConfigPatch | undefined> => {
  if (!isModelChange(changes)) {
    return changes;
  }

  if (ctx.mode !== "tui") {
    throw new Error(
      "Model changes require Pi's interactive TUI so you can choose from the existing model picker. No settings were changed."
    );
  }

  validateRequestedModels(changes, getConfiguredModelRefs(ctx));

  const selection = await selectModels(ctx, pickerOptions(changes, before));

  if (!selection) {
    return undefined;
  }

  return selectedModelChanges(changes, selection, persisted);
};
