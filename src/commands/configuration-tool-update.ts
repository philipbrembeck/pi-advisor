import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { getAdvisorSettings, setContextMaxCharsRef } from "../config/state.ts";
import {
  configPaths,
  loadConfig,
  readGlobalAdvisorConfig,
  rebaseConfigBaseline,
  saveGlobalAdvisorConfigPatch,
  saveGlobalOutcomeLogging,
} from "../config/storage.ts";
import type { JsonValue, RecordValue } from "../content-utils.ts";
import { resolveModelChanges } from "./configuration-tool-models.ts";
import type { SelectAdvisorModels } from "./configuration-tool-models.ts";
import {
  addAdvisorConfigDependencies,
  getAdvisorConfigSnapshot,
  validateAdvisorConfigPatch,
} from "./configuration-tool-policy.ts";
import type {
  AdvisorConfigPatch,
  AdvisorConfigSnapshot,
} from "./configuration-tool-policy.ts";
import {
  advisorConfigRiskNotes,
  effectiveChanges,
  sameConfigPatch,
  sameConfigValue,
  staleCheckKeys,
  summarizeAdvisorConfigPatch,
} from "./configuration-tool-preview.ts";
import {
  applyAdvisorConfigRuntimeSettings,
  cancelledAdvisorConfigResult,
  unchangedAdvisorConfigResult,
} from "./configuration-tool-runtime.ts";
import type { CommandRuntime } from "./types.ts";

interface PreparedAdvisorConfigUpdate {
  before: AdvisorConfigSnapshot;
  beforeSettings: ReturnType<typeof getAdvisorSettings>;
  configPath: string;
  existing: RecordValue;
  proposed: AdvisorConfigPatch;
}

const prepareAdvisorConfigUpdate = async (
  ctx: ExtensionContext,
  input: JsonValue | undefined,
  selectModels?: SelectAdvisorModels
): Promise<PreparedAdvisorConfigUpdate | undefined> => {
  const existing = readGlobalAdvisorConfig();
  const before = getAdvisorConfigSnapshot();
  const beforeSettings = getAdvisorSettings();
  const [, configPath] = configPaths(ctx);

  if (!configPath) {
    throw new Error("Could not resolve the global Advisor configuration path.");
  }

  if (input === undefined) {
    throw new TypeError("Provide Advisor settings changes for action=update.");
  }

  if (
    !validateAdvisorConfigPatch(input, Boolean(existing.advisorJevClassifier))
  ) {
    throw new TypeError("Advisor settings changes must be a JSON object.");
  }

  const initialChanges = input;

  if (
    Object.hasOwn(initialChanges, "advisorOutcomeLogging") &&
    Object.keys(initialChanges).length > 1
  ) {
    throw new Error(
      "Update advisorOutcomeLogging by itself so its separate consent path remains clear."
    );
  }

  const changesWithModels = await resolveModelChanges(
    ctx,
    initialChanges,
    before,
    existing,
    selectModels
  );

  if (!changesWithModels) {
    return undefined;
  }

  const changes = addAdvisorConfigDependencies(changesWithModels);

  return {
    before,
    beforeSettings,
    configPath,
    existing,
    proposed: effectiveChanges(changes, existing),
  };
};

const confirmAdvisorConfigUpdate = async (
  ctx: ExtensionContext,
  prepared: PreparedAdvisorConfigUpdate,
  signal?: AbortSignal
) => {
  const preview = summarizeAdvisorConfigPatch(
    prepared.proposed,
    prepared.before,
    prepared.existing
  );

  const risks = advisorConfigRiskNotes(
    prepared.proposed,
    prepared.before,
    prepared.existing
  );

  const confirmation = [
    "These changes apply to global Advisor settings, not a project config:",
    preview,
    ...risks.map((risk) => `\nRisk: ${risk}`),
  ].join("\n");

  const confirmed = await ctx.ui.confirm(
    "Apply Advisor settings?",
    confirmation,
    { signal }
  );

  return confirmed && !signal?.aborted;
};

const persistAdvisorConfigUpdate = (
  prepared: PreparedAdvisorConfigUpdate,
  signal?: AbortSignal
) => {
  const touched = staleCheckKeys(prepared.proposed);

  return withFileMutationQueue(prepared.configPath, () =>
    Promise.resolve().then(() => {
      if (signal?.aborted) {
        throw new Error(
          "Update cancelled before writing; no settings changed."
        );
      }

      const latest = readGlobalAdvisorConfig();

      const stale = touched.filter(
        (key) =>
          Object.hasOwn(latest, key) !==
            Object.hasOwn(prepared.existing, key) ||
          !sameConfigValue(latest[key] ?? null, prepared.existing[key] ?? null)
      );

      if (stale.length > 0) {
        throw new Error(
          `Advisor settings changed while confirmation was open (${stale.join(", ")}). Read the settings again and retry; nothing was written.`
        );
      }

      const refreshed = effectiveChanges(
        addAdvisorConfigDependencies(prepared.proposed),
        latest
      );

      if (!sameConfigPatch(refreshed, prepared.proposed)) {
        throw new Error(
          "Advisor setting dependencies changed while confirmation was open. Read the settings again and retry; nothing was written."
        );
      }

      if (Object.hasOwn(refreshed, "advisorOutcomeLogging")) {
        saveGlobalOutcomeLogging(
          refreshed.advisorOutcomeLogging === null
            ? null
            : refreshed.advisorOutcomeLogging === true,
          prepared.existing,
          touched
        );
      } else {
        saveGlobalAdvisorConfigPatch(refreshed, prepared.existing, touched);
      }

      return prepared.configPath;
    })
  );
};

const appliedAdvisorConfigResult = (
  prepared: PreparedAdvisorConfigUpdate,
  savedPath: string
) => {
  const notices: string[] = [];

  if (
    Object.hasOwn(prepared.proposed, "alwaysOn") &&
    prepared.proposed.alwaysOn === true
  ) {
    notices.push(
      "Always on applies to future sessions; this did not start an Advisor call."
    );
  }

  if (Object.hasOwn(prepared.proposed, "executor")) {
    notices.push(
      prepared.proposed.executor === null
        ? "The Executor pin was removed; it now follows the current Pi session model."
        : "Executor model selection is saved; run /advisor to activate it in this session."
    );
  }

  return {
    content: [
      {
        text: [
          `Saved Advisor settings to ${savedPath}.`,
          summarizeAdvisorConfigPatch(
            prepared.proposed,
            prepared.before,
            prepared.existing
          ),
          ...notices,
        ].join("\n"),
        type: "text" as const,
      },
    ],
    details: {
      action: "update",
      applied: true,
      changes: prepared.proposed,
      saved: true,
    },
  };
};

const savedButNotAppliedResult = (
  prepared: PreparedAdvisorConfigUpdate,
  savedPath: string,
  message: string
) => ({
  content: [
    {
      text: `Advisor settings were saved to ${savedPath}, but could not be fully applied to the current session: ${message}`,
      type: "text" as const,
    },
  ],
  details: {
    action: "update",
    applied: false,
    changes: prepared.proposed,
    saved: true,
  },
});

const applyAdvisorConfigUpdate = (
  runtime: CommandRuntime,
  ctx: ExtensionContext,
  prepared: PreparedAdvisorConfigUpdate,
  savedPath: string
) => {
  try {
    loadConfig(ctx);

    if (
      !Object.hasOwn(prepared.proposed, "contextMaxChars") &&
      prepared.before.contextMaxChars !== undefined
    ) {
      setContextMaxCharsRef(prepared.before.contextMaxChars);
      rebaseConfigBaseline();
    }

    applyAdvisorConfigRuntimeSettings(runtime, ctx, prepared.beforeSettings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return savedButNotAppliedResult(prepared, savedPath, message);
  }

  return appliedAdvisorConfigResult(prepared, savedPath);
};

export const executeAdvisorConfigUpdate = async (
  runtime: CommandRuntime,
  ctx: ExtensionContext,
  input: JsonValue | undefined,
  signal?: AbortSignal,
  selectModels?: SelectAdvisorModels
) => {
  if (!ctx.hasUI) {
    throw new Error(
      "Advisor setting updates require an interactive confirmation. Use Pi's TUI or RPC UI; no settings were changed."
    );
  }

  const prepared = await prepareAdvisorConfigUpdate(ctx, input, selectModels);

  if (!prepared) {
    return cancelledAdvisorConfigResult(
      "Model selection cancelled; no settings changed."
    );
  }

  if (Object.keys(prepared.proposed).length === 0) {
    return unchangedAdvisorConfigResult(
      "Advisor settings already match the request."
    );
  }

  if (!(await confirmAdvisorConfigUpdate(ctx, prepared, signal))) {
    return cancelledAdvisorConfigResult(
      "Update cancelled; no settings changed."
    );
  }

  let savedPath: string;

  try {
    savedPath = await persistAdvisorConfigUpdate(prepared, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Advisor settings were not saved: ${message}`, {
      cause: error,
    });
  }

  return applyAdvisorConfigUpdate(runtime, ctx, prepared, savedPath);
};
