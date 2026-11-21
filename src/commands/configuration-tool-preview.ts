import { configKeys } from "../config/schema.ts";
import type { ConfigKey } from "../config/schema.ts";
import type { JsonValue, RecordValue } from "../content-utils.ts";
import type {
  AdvisorConfigPatch,
  AdvisorConfigSnapshot,
} from "./configuration-tool-policy.ts";

export const sameConfigValue = (
  left: JsonValue | undefined,
  right: JsonValue | undefined
) => JSON.stringify(left) === JSON.stringify(right);

const orderedPatchEntries = (patch: AdvisorConfigPatch) =>
  configKeys
    .filter((key) => Object.hasOwn(patch, key))
    .map((key) => [key, patch[key]]);

export const sameConfigPatch = (
  left: AdvisorConfigPatch,
  right: AdvisorConfigPatch
) =>
  JSON.stringify(orderedPatchEntries(left)) ===
  JSON.stringify(orderedPatchEntries(right));

export const effectiveChanges = (
  changes: AdvisorConfigPatch,
  persisted: RecordValue
): AdvisorConfigPatch => {
  const entries: [string, JsonValue][] = [];

  for (const key of configKeys) {
    const value = changes[key];

    if (value === undefined) {
      continue;
    }

    if (value === null) {
      if (Object.hasOwn(persisted, key)) {
        entries.push([key, null]);
      }

      continue;
    }

    if (!sameConfigValue(value, persisted[key] ?? null)) {
      entries.push([key, value]);
    }
  }

  // SAFETY: entries are built only from configKeys and the validated sparse patch.
  return Object.fromEntries(entries) as AdvisorConfigPatch;
};

export const staleCheckKeys = (changes: AdvisorConfigPatch): ConfigKey[] => {
  const keys = new Set(configKeys.filter((key) => Object.hasOwn(changes, key)));

  if (keys.has("advisorToolsEnabled") || keys.has("alwaysOn")) {
    keys.add("advisorToolsEnabled");
    keys.add("alwaysOn");
  }

  if (
    keys.has("advisorJevFilterEnabled") ||
    keys.has("advisorJevTurnGateEveryTurns")
  ) {
    keys.add("advisorJevClassifier");
  }

  return [...keys];
};

export const summarizeAdvisorConfigPatch = (
  changes: AdvisorConfigPatch,
  before: AdvisorConfigSnapshot,
  persisted: RecordValue
) =>
  configKeys
    .filter((key) => Object.hasOwn(changes, key))
    .map((key) => {
      const value = changes[key];

      const previous = Object.hasOwn(persisted, key)
        ? JSON.stringify(persisted[key])
        : `unset (extension default; current session ${JSON.stringify(before[key] ?? null)})`;

      const next =
        value === null ? "reset to extension default" : JSON.stringify(value);

      return `- ${key}: ${previous} → ${next}`;
    })
    .join("\n");

const enabledToolsRiskNote = (
  sessionScoped: boolean,
  alwaysOn: boolean,
  enabledByAlwaysOn: boolean
) => {
  if (sessionScoped && enabledByAlwaysOn) {
    return "The saved tool preference changes; enabling Always on does not activate this session.";
  }

  if (sessionScoped) {
    return "Advisor tools become available in this session; later session starts remain inactive.";
  }

  if (alwaysOn) {
    return "Advisor tools become available, and saved Always on will activate the flow in future sessions.";
  }

  return "Advisor tools become available; this does not activate Always on.";
};

const activationRiskNotes = (
  changes: AdvisorConfigPatch,
  before: AdvisorConfigSnapshot
) => {
  const notes: string[] = [];

  const sessionScoped =
    changes.advisorActivation === "session" ||
    (changes.advisorActivation === undefined &&
      before.advisorActivation === "session");

  if (changes.advisorActivation === "session") {
    notes.push(
      "The current Advisor on/off state is kept; advisor_config follows it. Every session start, including /reload, starts inactive even when Always on is saved."
    );
  }

  if (
    changes.advisorActivation === "persistent" ||
    changes.advisorActivation === null
  ) {
    notes.push(
      "Persistent mode applies the saved Advisor tools preference immediately and makes advisor_config available."
    );
  }

  if (changes.advisorToolsEnabled === false) {
    notes.push(
      sessionScoped
        ? "Advisor tools, including advisor_config, will be disabled immediately; use /advisor to enable them for this session."
        : "Advisor tools will be disabled immediately. advisor_config remains available to re-enable them."
    );
  }

  if (changes.alwaysOn === true) {
    notes.push(
      sessionScoped
        ? "Always on is saved, but session activation starts inactive."
        : "Always on enables automatic activation for future sessions."
    );
  }

  if (changes.advisorToolsEnabled === true) {
    notes.push(
      enabledToolsRiskNote(
        sessionScoped,
        before.alwaysOn === true || changes.alwaysOn === true,
        changes.alwaysOn === true && before.advisorToolsEnabled === false
      )
    );
  }

  return notes;
};

const automationRiskNotes = (
  changes: AdvisorConfigPatch,
  before: AdvisorConfigSnapshot
) => {
  const notes = activationRiskNotes(changes, before);

  if (changes.simpleMode === true) {
    notes.push(
      "Simple mode disables automatic gates, gate blocking, and configured call budgets; voluntary Advisor calls remain available."
    );
  }

  if (
    changes.advisorPlanGate === true ||
    changes.advisorFailureGate === true ||
    changes.advisorCompletionGate === true ||
    changes.advisorAutoLoopGate === true
  ) {
    notes.push(
      "Automatic gates may request extra Advisor calls; loop-gate failures can block a tool or session under the selected failure policy."
    );
  }

  if (
    changes.gateFailureMode === "block-session" ||
    changes.advisorBlockOnBlocked === true
  ) {
    notes.push("A blocked gate may stop the current session.");
  }

  return notes;
};

const disclosureRiskNotes = (
  changes: AdvisorConfigPatch,
  before: AdvisorConfigSnapshot
) => {
  const notes: string[] = [];

  if (changes.advisorGitContext === "full") {
    notes.push(
      "Future Advisor requests may include repository patch contents."
    );
  }

  if (changes.advisorTrackedFileContent === true) {
    notes.push(
      "This enables explicitly requested tracked file contents to be sent to the Advisor."
    );
  }

  if (changes.advisorTrackedFileHandoff === "executor") {
    notes.push(
      "The Executor will choose which tracked files to attach, and their contents may be sent to the Advisor on any consultation without the Advisor naming them first. Tracked file content consent is still required."
    );
  }

  // A null patch value resets to the extension default: consent off, advisor-named.
  const trackedFileContent =
    changes.advisorTrackedFileContent === undefined
      ? before.advisorTrackedFileContent
      : changes.advisorTrackedFileContent;

  const trackedFileHandoff =
    changes.advisorTrackedFileHandoff === undefined
      ? before.advisorTrackedFileHandoff
      : changes.advisorTrackedFileHandoff;

  // Only a tracked-file change can create this state; unrelated updates must not repeat it.
  const touchesTrackedFiles =
    changes.advisorTrackedFileContent !== undefined ||
    changes.advisorTrackedFileHandoff !== undefined;

  if (
    touchesTrackedFiles &&
    trackedFileHandoff === "executor" &&
    trackedFileContent !== true
  ) {
    notes.push(
      "Executor tracked file handoff has no effect until Tracked file content is enabled."
    );
  }

  if (changes.advisorUntrackedContent === true) {
    notes.push(
      "This enables explicitly requested untracked file contents to be sent to the Advisor."
    );
  }

  if (changes.advisorAgentsMdContext === true) {
    notes.push(
      "Trusted AGENTS.md instructions may be included in Advisor requests."
    );
  }

  if (
    changes.advisorToolPolicies &&
    Object.values(changes.advisorToolPolicies).includes("full")
  ) {
    notes.push(
      "Tools set to full may send their arguments and result content to the Advisor."
    );
  }

  if (changes.advisorRedactSecrets === false) {
    notes.push(
      "Credential-pattern redaction will be off for Advisor requests."
    );
  }

  return notes;
};

const costRiskNotes = (changes: AdvisorConfigPatch) => {
  const notes: string[] = [];

  if (changes.advisorOutcomeLogging === true) {
    notes.push(
      "Outcome logging stores bounded adoption and validation metadata in the local ledger."
    );
  }

  if (changes.advisorMaxCallsPerSession === null) {
    notes.push(
      "This removes the per-session Advisor call limit; calls may be unlimited."
    );
  }

  if ((changes.advisorJevTurnGateEveryTurns ?? 0) > 0) {
    notes.push(
      "The Jev turn gate can initiate proactive Advisor calls and add cost."
    );
  }

  return notes;
};

export const advisorConfigRiskNotes = (
  changes: AdvisorConfigPatch,
  before: AdvisorConfigSnapshot,
  persisted: RecordValue
) => [
  ...automationRiskNotes(changes, {
    ...before,
    alwaysOn: Object.hasOwn(persisted, "alwaysOn")
      ? persisted.alwaysOn === true
      : before.alwaysOn,
  }),
  ...disclosureRiskNotes(changes, before),
  ...costRiskNotes(changes),
];
