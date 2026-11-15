import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { getAdvisorSettings } from "../config/state.ts";
import {
  readGlobalAdvisorConfig,
  saveGlobalAdvisorConfigPatch,
  saveGlobalOutcomeLogging,
} from "../config/storage.ts";
import type { RecordValue } from "../content-utils.ts";
import { addAdvisorConfigDependencies } from "./configuration-tool-policy.ts";
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

export interface PreparedAdvisorConfigUpdate {
  before: AdvisorConfigSnapshot;
  beforeSettings: ReturnType<typeof getAdvisorSettings>;
  configPath: string;
  existing: RecordValue;
  proposed: AdvisorConfigPatch;
}

export const confirmAdvisorConfigUpdate = async (
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

export const persistAdvisorConfigUpdate = (
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
