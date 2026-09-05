import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { applyConfig, resetDefaults } from "./defaults.js";
import {
  advisorAutoLoopGateRef,
  advisorBlockOnBlockedRef,
  advisorCollapseResponsesRef,
  advisorCompletionGateRef,
  advisorCustomInvocationRef,
  advisorEffortRef,
  advisorFailureGateRef,
  advisorFailureModeRef,
  advisorGitContextMaxCharsRef,
  advisorGitContextRef,
  advisorHerdrIntegrationRef,
  advisorLoopThresholdRef,
  advisorMaxCallsPerSessionRef,
  advisorPlanGateRef,
  advisorRedactSecretsRef,
  advisorRef,
  advisorScoutEnabledRef,
  advisorSessionSummaryRef,
  advisorToolPoliciesRef,
  advisorToolResultMaxBytesRef,
  advisorToolResultMaxLinesRef,
  advisorTrackedFileContentRef,
  advisorUntrackedContentRef,
  alwaysOnRef,
  contextMaxCharsRef,
  executorEffortRef,
  executorRef,
  setAdvisorOutcomeLoggingRef,
  setPersistedModelRefs,
  showUsageDetailsRef,
  showUsageFooterRef,
  simpleModeRef,
} from "./state.js";
import type { AdvisorConfig } from "./types.js";
import { unknownConfigKeys, validateConfig } from "./validation.js";

export const configPaths = (ctx: ExtensionContext) => [
  ctx.isProjectTrusted()
    ? join(ctx.cwd, CONFIG_DIR_NAME, "advisor.json")
    : null,
  join(getAgentDir(), "advisor.json"),
];

const configuredModelRef = (value: string | undefined): string | undefined =>
  value?.trim() || undefined;

const readConfig = (path: string): AdvisorConfig => {
  try {
    const config = JSON.parse(readFileSync(path, "utf8"));
    validateConfig(config, path);
    return config;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
};

// loadConfig runs on every tool call and every consultation. Caching the parsed
// file by path and stat identity removes that read and parse from the hot path
// while still applying the full reset-then-apply sequence on each call.
const configCache = new Map<
  string,
  { config: AdvisorConfig; identity: string }
>();
const warnedUnknownConfigIdentities = new Set<string>();

/** Drops the parsed-configuration cache; the next load re-reads from disk. */
export const resetConfigCache = () => {
  configCache.clear();
  warnedUnknownConfigIdentities.clear();
};

/**
 * Nanosecond timestamps plus size and inode so a same-millisecond or
 * same-size external rewrite cannot be served from the cache. An unstattable
 * path yields a unique value, which always forces a re-read.
 */
const configIdentity = (path: string): string => {
  try {
    const stats = statSync(path, { bigint: true });
    return `${stats.mtimeNs}:${stats.ctimeNs}:${stats.size}:${stats.ino}:${stats.dev}`;
  } catch {
    return `unstattable:${process.hrtime.bigint()}`;
  }
};

const readConfigCached = (path: string): AdvisorConfig => {
  const identity = configIdentity(path);
  const cached = configCache.get(path);
  if (cached?.identity === identity) {
    return cached.config;
  }
  const config = readConfig(path);
  configCache.set(path, { config, identity });
  return config;
};

export const loadConfig = (_ctx: ExtensionContext) => {
  resetDefaults();
  const global = join(getAgentDir(), "advisor.json");
  const globalConfig = existsSync(global)
    ? readConfigCached(global)
    : undefined;
  setPersistedModelRefs(
    configuredModelRef(globalConfig?.advisor),
    configuredModelRef(globalConfig?.executor)
  );
  if (globalConfig) {
    applyConfig(globalConfig);
    const unknownKeys = unknownConfigKeys(
      globalConfig as Record<string, unknown>
    );
    const warningIdentity = `${global}:${configIdentity(global)}`;
    if (
      unknownKeys.length > 0 &&
      _ctx.hasUI &&
      !warnedUnknownConfigIdentities.has(warningIdentity)
    ) {
      _ctx.ui.notify(
        `Advisor configuration at ${global} contains unrecognized key(s) ${unknownKeys.map((key) => JSON.stringify(key)).join(", ")}. They were preserved but ignored; check for typos or upgrade pi-advisor.`,
        "warning"
      );
      warnedUnknownConfigIdentities.add(warningIdentity);
    }
  }
  // Repository-controlled project configuration is never applied. Models,
  // prompts, gates, budgets, disclosure, redaction, integrations, and consent
  // remain under the user's global Pi configuration.
  setAdvisorOutcomeLoggingRef(globalConfig?.advisorOutcomeLogging === true);
  return existsSync(global) ? global : null;
};

/** Saves user-controlled configuration globally without outcome consent. */
export interface SaveConfigOptions {
  persistAdvisor?: boolean;
  persistExecutor?: boolean;
}

export const saveConfig = (
  _ctx: ExtensionContext,
  options: SaveConfigOptions = {}
) => {
  const path = join(getAgentDir(), "advisor.json");
  const persistAdvisor = options.persistAdvisor ?? true;
  const persistExecutor = options.persistExecutor ?? true;
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    /* replace a missing or malformed file */
  }
  if (advisorMaxCallsPerSessionRef === undefined) {
    existing.advisorMaxCallsPerSession = undefined;
  }
  const data = {
    ...existing,
    ...(persistAdvisor && advisorRef ? { advisor: advisorRef } : {}),
    advisorAutoLoopGate: advisorAutoLoopGateRef,
    advisorBlockOnBlocked: advisorBlockOnBlockedRef,
    advisorCollapseResponses: advisorCollapseResponsesRef,
    advisorCompletionGate: advisorCompletionGateRef,
    advisorCustomInvocation: advisorCustomInvocationRef,
    advisorEffort: advisorEffortRef,
    advisorFailureGate: advisorFailureGateRef,
    advisorLoopThreshold: advisorLoopThresholdRef,
    advisorPlanGate: advisorPlanGateRef,
    contextMaxChars: contextMaxCharsRef,
    ...(persistExecutor && executorRef ? { executor: executorRef } : {}),
    executorEffort: executorEffortRef,
    ...(advisorMaxCallsPerSessionRef === undefined
      ? {}
      : { advisorMaxCallsPerSession: advisorMaxCallsPerSessionRef }),
    advisorGitContext: advisorGitContextRef,
    advisorGitContextMaxChars: advisorGitContextMaxCharsRef,
    advisorHerdrIntegration: advisorHerdrIntegrationRef,
    advisorRedactSecrets: advisorRedactSecretsRef,
    advisorScoutEnabled: advisorScoutEnabledRef,
    advisorSessionSummary: advisorSessionSummaryRef,
    advisorToolPolicies: advisorToolPoliciesRef,
    advisorToolResultMaxBytes: advisorToolResultMaxBytesRef,
    advisorToolResultMaxLines: advisorToolResultMaxLinesRef,
    advisorTrackedFileContent: advisorTrackedFileContentRef,
    advisorUntrackedContent: advisorUntrackedContentRef,
    alwaysOn: alwaysOnRef,
    gateFailureMode: advisorFailureModeRef,
    showUsageDetails: showUsageDetailsRef,
    showUsageFooter: showUsageFooterRef,
    simpleMode: simpleModeRef,
  };
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  resetConfigCache();
  return path;
};

/** Outcome logging is deliberately written only to the global Pi configuration. */
export const saveGlobalOutcomeLogging = (enabled: boolean) => {
  const path = join(getAgentDir(), "advisor.json");
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    /* create it */
  }
  writeFileSync(
    path,
    `${JSON.stringify({ ...existing, advisorOutcomeLogging: enabled }, null, 2)}\n`
  );
  resetConfigCache();
  return path;
};
