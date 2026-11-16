import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerCommands } from "../src/commands.ts";
import { saveAdvisorSettings } from "../src/commands/settings-persistence.ts";
import { CONFIG_SCHEMA, SAVED_CONFIG_KEYS } from "../src/config/schema.ts";
import {
  getAdvisorSettings,
  setAdvisorEffortRef,
  setAdvisorRef,
  setAdvisorToolsEnabledRef,
  setExecutorEffortRef,
  setExecutorRef,
  setShowUsageFooterRef,
} from "../src/config/state.ts";
import {
  loadConfig,
  readGlobalAdvisorConfig,
  resetConfigCache,
  saveConfig,
  saveGlobalAdvisorConfigPatch,
  saveGlobalOutcomeLogging,
} from "../src/config/storage.ts";
import { savedConfig, withAgentDir } from "./helpers/config-fixture.ts";
import { mockPi } from "./helpers/mock-pi.ts";

type JsonValue =
  boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

// SAFETY: mock context exercises only hasUI-aware paths in this suite.
const context = { hasUI: false } as any;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
let agentDir = "";

const configPath = () => join(agentDir, "advisor.json");

const readSavedConfig = () =>
  // SAFETY: advisor.json is flat JSON written by saveConfig in these fixtures.
  JSON.parse(readFileSync(configPath(), "utf-8")) as Record<string, JsonValue>;

describe("Advisor config persistence", () => {
  let advisorToolsEnabledSnapshot: boolean;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-flow-test-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    advisorToolsEnabledSnapshot = getAdvisorSettings().advisorToolsEnabled;
  });

  afterEach(() => {
    // setAdvisorToolsEnabledRef mutates module-global state that concurrently
    // scheduled test files observe; restore it so the opt-out test cannot
    // leak "disabled" into other suites.
    setAdvisorToolsEnabledRef(advisorToolsEnabledSnapshot);
    resetConfigCache();
    rmSync(agentDir, { force: true, recursive: true });

    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
  });

  test("saves sparse global patches while preserving unknown fields and secrets", () => {
    const original = {
      advisor: "openai-codex/advisor",
      futureSetting: { keep: true },
      simpleMode: false,
      typesafe_api_key: "keep-private",
    };

    writeFileSync(configPath(), JSON.stringify(original));
    loadConfig(context);

    saveGlobalAdvisorConfigPatch({ contextMaxChars: 25_000, simpleMode: true });

    expect(readSavedConfig()).toEqual({
      ...original,
      contextMaxChars: 25_000,
      simpleMode: true,
    });
    loadConfig(context);
    expect(getAdvisorSettings().simpleMode).toBe(true);
    expect(getAdvisorSettings().contextMaxChars).toBe(25_000);
  });

  test("null removes an override and invalid patches leave the file unchanged", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({ advisorLoopThreshold: 3, contextMaxChars: 30_000 })
    );
    loadConfig(context);

    saveGlobalAdvisorConfigPatch({ contextMaxChars: null });
    expect(readSavedConfig()).not.toHaveProperty("contextMaxChars");

    const beforeInvalidPatch = readFileSync(configPath(), "utf-8");
    expect(() =>
      saveGlobalAdvisorConfigPatch({ advisorLoopThreshold: 1 })
    ).toThrow("advisorLoopThreshold");
    expect(() =>
      saveGlobalAdvisorConfigPatch({ futureModelSetting: true })
    ).toThrow("unsupported key");
    expect(readFileSync(configPath(), "utf-8")).toBe(beforeInvalidPatch);
  });

  test("rejects a config patch if a targeted value changed after confirmation", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({ externallyEdited: true, simpleMode: false })
    );
    const expected = readGlobalAdvisorConfig();
    const concurrent = { externallyEdited: true, simpleMode: true };
    writeFileSync(configPath(), JSON.stringify(concurrent));

    expect(() =>
      saveGlobalAdvisorConfigPatch({ simpleMode: false }, expected)
    ).toThrow("changed during confirmation");
    expect(readSavedConfig()).toEqual(concurrent);
  });

  test("rejects a dependent value changed between stale check and patch persistence", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({ advisorToolsEnabled: false, alwaysOn: false })
    );
    const expected = readGlobalAdvisorConfig();
    const concurrent = { advisorToolsEnabled: false, alwaysOn: true };
    writeFileSync(configPath(), JSON.stringify(concurrent));

    expect(() =>
      saveGlobalAdvisorConfigPatch({ advisorToolsEnabled: true }, expected, [
        "advisorToolsEnabled",
        "alwaysOn",
      ])
    ).toThrow("changed during confirmation");
    expect(readSavedConfig()).toEqual(concurrent);
  });

  test("checks dependent read-set values for the separate outcome writer", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({
        advisorOutcomeLogging: false,
        advisorToolsEnabled: true,
        alwaysOn: false,
      })
    );

    const expected = readGlobalAdvisorConfig();

    const concurrent = {
      advisorOutcomeLogging: false,
      advisorToolsEnabled: false,
      alwaysOn: false,
    };

    writeFileSync(configPath(), JSON.stringify(concurrent));

    expect(() =>
      saveGlobalOutcomeLogging(true, expected, [
        "advisorOutcomeLogging",
        "advisorToolsEnabled",
        "alwaysOn",
      ])
    ).toThrow("changed during confirmation");
    expect(readSavedConfig()).toEqual(concurrent);
  });

  test("does not replace malformed JSON during a configuration patch", () => {
    const malformed = '{"simpleMode":true,\n';
    writeFileSync(configPath(), malformed);

    expect(() => saveGlobalAdvisorConfigPatch({ simpleMode: false })).toThrow(
      "malformed"
    );
    expect(readFileSync(configPath(), "utf-8")).toBe(malformed);
  });

  test("persists the Advisor tools opt-out and defaults it on for old configs", () => {
    writeFileSync(configPath(), JSON.stringify({ alwaysOn: false }));
    loadConfig(context);
    expect(getAdvisorSettings().advisorToolsEnabled).toBe(true);

    setAdvisorToolsEnabledRef(false);
    saveConfig(context);
    expect(readSavedConfig().advisorToolsEnabled).toBe(false);

    resetConfigCache();
    loadConfig(context);
    expect(getAdvisorSettings().advisorToolsEnabled).toBe(false);
  });

  test("loads and persists Advisor log feedback", () => {
    writeFileSync(configPath(), JSON.stringify({ advisorLogFeedback: true }));
    loadConfig(context);

    expect(getAdvisorSettings().logFeedback).toBe(true);
    saveConfig(context);
    expect(readSavedConfig().advisorLogFeedback).toBe(true);
  });

  test("preserves external known and unknown edits during unrelated saves", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({
        advisor: "openai-codex/advisor",
        advisorScoutEnabled: true,
        alwaysOn: false,
        executor: "openai-codex/executor",
      })
    );
    loadConfig(context);

    writeFileSync(
      configPath(),
      JSON.stringify({
        advisor: "openai-codex/advisor",
        advisorScoutEnabled: false,
        alwaysOn: true,
        executor: "openai-codex/executor",
        externallyEdited: "keep me",
      })
    );
    setShowUsageFooterRef(true);
    saveConfig(context);

    const saved = readSavedConfig();
    expect(saved.advisorScoutEnabled).toBe(false);
    expect(saved.alwaysOn).toBe(true);
    expect(saved.externallyEdited).toBe("keep me");
    expect(saved.showUsageFooter).toBe(true);
  });

  test("does not replace malformed configuration during a save", () => {
    const malformed = '{"advisor":"openai-codex/advisor",\n';
    writeFileSync(configPath(), malformed);
    setShowUsageFooterRef(true);

    expect(() => saveConfig(context)).toThrow("malformed");
    expect(readFileSync(configPath(), "utf-8")).toBe(malformed);
  });

  test("rolls back runtime settings when persistence fails", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({ advisor: "openai-codex/advisor", simpleMode: false })
    );
    loadConfig(context);
    const previous = getAdvisorSettings();

    rmSync(configPath(), { force: true, recursive: true });
    mkdirSync(configPath());
    expect(() =>
      saveAdvisorSettings(context, { ...previous, simpleMode: true })
    ).toThrow();
    expect(getAdvisorSettings().simpleMode).toBe(previous.simpleMode);
  });

  test("preserves legacy JEV fields, plaintext keys, and unknown fields during saves", () => {
    const legacy = {
      advisorJevBaseUrl: "https://legacy.example.test",
      advisorJevModel: "jev-legacy-model",
      advisorJevPricePerMtok: 0.042,
      advisorJevTransport: "typesafe-compatible",
      futureJevSetting: { keep: true },
      typesafe_api_key: "legacy-plaintext-secret",
      unrelated: "preserve",
    };

    writeFileSync(configPath(), JSON.stringify(legacy));
    loadConfig(context);

    setShowUsageFooterRef(true);
    saveConfig(context);

    expect(readSavedConfig()).toMatchObject(legacy);

    expect(readSavedConfig()).not.toHaveProperty("advisorJevClassifier");
    expect(readSavedConfig()).not.toHaveProperty("jevClassifierApiKey");
  });

  test("warns once when a legacy filter is enabled without a classifier", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({ advisorJevFilterEnabled: true })
    );

    const notifications: { kind: string; message: string }[] = [];

    // SAFETY: mock context exercises only the hasUI-aware loadConfig notify path.
    const uiContext = {
      hasUI: true,
      ui: {
        notify: (message: string, kind: string) =>
          notifications.push({ kind, message }),
      },
    } as any;

    loadConfig(context);
    loadConfig(uiContext);
    loadConfig(uiContext);

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.kind).toBe("warning");
    expect(notifications[0]?.message).toContain(
      "no Jev classifier is selected"
    );
  });

  test("Jev setup skips a separate outcome-consent write and preserves the stored field", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({
        advisor: "openai-codex/advisor",
        advisorJevTransport: "auto",
        advisorOutcomeLogging: true,
        futureSetting: "preserve",
      })
    );
    loadConfig(context);
    const previous = getAdvisorSettings();
    saveAdvisorSettings(
      context,
      {
        ...previous,
        jevClassifier: "openai/gpt-6-luna",
        jevFilterEnabled: true,
        outcomeLogging: false,
      },
      { skipOutcomeLogging: true }
    );

    expect(readSavedConfig()).toMatchObject({
      advisorJevClassifier: "openai/gpt-6-luna",
      advisorJevFilterEnabled: true,
      advisorJevTransport: "auto",
      advisorOutcomeLogging: true,
      futureSetting: "preserve",
    });
  });

  test("persists intentional clears as deletions", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({
        advisor: "openai-codex/advisor",
        advisorEffort: "high",
        executor: "openai-codex/executor",
        executorEffort: "xhigh",
      })
    );
    loadConfig(context);
    setAdvisorEffortRef(undefined);
    setExecutorEffortRef(undefined);
    saveConfig(context);

    const saved = readSavedConfig();
    expect(saved).not.toHaveProperty("advisorEffort");
    expect(saved).not.toHaveProperty("executorEffort");
  });

  test("honors model persistence flags across later saves", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({
        advisor: "openai-codex/advisor",
        executor: "openai-codex/executor",
      })
    );
    loadConfig(context);
    setExecutorRef("openai-codex/new-executor");
    setShowUsageFooterRef(true);
    saveConfig(context, { persistExecutor: false });
    expect(readSavedConfig().executor).toBe("openai-codex/executor");

    saveConfig(context, { persistExecutor: true });
    expect(readSavedConfig().executor).toBe("openai-codex/new-executor");
  });

  test("keeps a model dirty after an initial restricted save", () => {
    setAdvisorRef("openai-codex/new-advisor");
    setExecutorRef("openai-codex/new-executor");
    setShowUsageFooterRef(true);

    saveConfig(context, { persistAdvisor: false, persistExecutor: false });
    expect(readSavedConfig()).not.toHaveProperty("advisor");
    expect(readSavedConfig()).not.toHaveProperty("executor");

    saveConfig(context, { persistAdvisor: true, persistExecutor: true });
    expect(readSavedConfig().advisor).toBe("openai-codex/new-advisor");
    expect(readSavedConfig().executor).toBe("openai-codex/new-executor");
  });

  test("uses existing models as the baseline for an initial restricted save", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({
        advisor: "openai-codex/old-advisor",
        executor: "openai-codex/old-executor",
      })
    );
    setAdvisorRef("openai-codex/new-advisor");
    setExecutorRef("openai-codex/new-executor");
    setShowUsageFooterRef(true);

    saveConfig(context, { persistAdvisor: false, persistExecutor: false });
    expect(readSavedConfig().advisor).toBe("openai-codex/old-advisor");
    expect(readSavedConfig().executor).toBe("openai-codex/old-executor");

    saveConfig(context, { persistAdvisor: true, persistExecutor: true });
    expect(readSavedConfig().advisor).toBe("openai-codex/new-advisor");
    expect(readSavedConfig().executor).toBe("openai-codex/new-executor");
  });

  test("keeps pending changes dirty when a save fails", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({
        advisor: "openai-codex/advisor",
        executor: "openai-codex/executor",
      })
    );
    loadConfig(context);
    setShowUsageFooterRef(true);

    rmSync(configPath(), { force: true, recursive: true });
    mkdirSync(configPath());
    expect(() => saveConfig(context)).toThrow();

    rmSync(configPath(), { force: true, recursive: true });
    writeFileSync(
      configPath(),
      JSON.stringify({
        advisor: "openai-codex/advisor",
        executor: "openai-codex/executor",
        externallyEdited: true,
      })
    );
    saveConfig(context);

    const saved = readSavedConfig();
    expect(saved.showUsageFooter).toBe(true);
    expect(saved.externallyEdited).toBe(true);
  });
});

describe("Advisor argument persistence", () => {
  test("does not persist arguments that name an unusable model", async () => {
    await withAgentDir(
      {
        alwaysOn: true,
        contextMaxChars: 15_000,
        executor: "good/executor",
      },
      async (dir) => {
        const commands = new Map<string, any>();
        const notes: string[] = [];
        registerCommands(
          mockPi(
            { activeTools: ["ask_advisor"], commands },
            {
              on: () => {},
              registerEntryRenderer: () => {},
              registerMessageRenderer: () => {},
              setActiveTools: () => {},
              setModel: () => Promise.resolve(true),
              setThinkingLevel: () => {},
            }
          )
        );

        // SAFETY: mock implements the consumed command context: cwd, hasUI, isProjectTrusted, modelRegistry, ui.
        await commands.get("advisor").handler("executor=missing/model", {
          cwd: dir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry: {
            find: (provider: string) =>
              provider === "missing" ? undefined : { id: "x", provider },
            getApiKeyAndHeaders: () =>
              Promise.resolve({ apiKey: "key", ok: true }),
          },
          ui: { notify: (message: string) => notes.push(message) },

          // SAFETY: mock implements the consumed command context: cwd, hasUI, isProjectTrusted, modelRegistry, ui.
        } as any);

        expect(notes.join("\n")).toContain("Executor model not found");
        // SAFETY: mock implements the consumed command context: cwd, hasUI, isProjectTrusted, modelRegistry, ui.
        await commands.get("advisor-off").handler("", {
          cwd: dir,
          hasUI: true,
          isProjectTrusted: () => false,
          ui: { notify: () => {} },

          // SAFETY: mock implements the consumed command context: cwd, hasUI, isProjectTrusted, modelRegistry, ui.
        } as any);
        expect(savedConfig(dir).executor).toBe("good/executor");
      }
    );
  });
});

describe("Config schema consistency", () => {
  test("every AdvisorConfig key has exactly one schema entry", () => {
    const schemaKeys = Object.keys(CONFIG_SCHEMA).toSorted();
    expect(schemaKeys).toEqual([
      "advisor",
      "advisorActivation",
      "advisorAgentsMdContext",
      "advisorAutoLoopGate",
      "advisorBlockOnBlocked",
      "advisorCollapseResponses",
      "advisorCompletionGate",
      "advisorCustomInvocation",
      "advisorDisableSameModel",
      "advisorEffort",
      "advisorFailureGate",
      "advisorFallbackModel",
      "advisorGitContext",
      "advisorGitContextMaxChars",
      "advisorHerdrIntegration",
      "advisorJevBaseUrl",
      "advisorJevClassifier",
      "advisorJevDigestMaxChars",
      "advisorJevFilterEnabled",
      "advisorJevFilterNoulMargin",
      "advisorJevFilterOverrideWindow",
      "advisorJevFilterSkipConfidence",
      "advisorJevKeyProvider",
      "advisorJevModel",
      "advisorJevPricePerMtok",
      "advisorJevTimeoutMs",
      "advisorJevTransport",
      "advisorJevTurnGateEveryTurns",
      "advisorJevTurnGateNoulThreshold",
      "advisorLogFeedback",
      "advisorLoopThreshold",
      "advisorMaxCallsPerSession",
      "advisorModelWhitelist",
      "advisorOutcomeLogging",
      "advisorPlanGate",
      "advisorRedactSecrets",
      "advisorScoutEnabled",
      "advisorScoutTimeoutMs",
      "advisorSessionSummary",
      "advisorToolPolicies",
      "advisorToolResultMaxBytes",
      "advisorToolResultMaxLines",
      "advisorToolsEnabled",
      "advisorTrackedFileContent",
      "advisorUntrackedContent",
      "alwaysOn",
      "contextMaxChars",
      "executor",
      "executorEffort",
      "gateFailureMode",
      "showUsageDetails",
      "showUsageFooter",
      "simpleMode",
    ]);
    expect(new Set(schemaKeys).size).toBe(schemaKeys.length);
  });

  test("persisted schema keys include every persisted setting", () => {
    expect([...SAVED_CONFIG_KEYS].toSorted()).toEqual([
      "advisor",
      "advisorActivation",
      "advisorAgentsMdContext",
      "advisorAutoLoopGate",
      "advisorBlockOnBlocked",
      "advisorCollapseResponses",
      "advisorCompletionGate",
      "advisorCustomInvocation",
      "advisorDisableSameModel",
      "advisorEffort",
      "advisorFailureGate",
      "advisorFallbackModel",
      "advisorGitContext",
      "advisorGitContextMaxChars",
      "advisorHerdrIntegration",
      "advisorJevBaseUrl",
      "advisorJevClassifier",
      "advisorJevDigestMaxChars",
      "advisorJevFilterEnabled",
      "advisorJevFilterNoulMargin",
      "advisorJevFilterOverrideWindow",
      "advisorJevFilterSkipConfidence",
      "advisorJevKeyProvider",
      "advisorJevModel",
      "advisorJevPricePerMtok",
      "advisorJevTimeoutMs",
      "advisorJevTransport",
      "advisorJevTurnGateEveryTurns",
      "advisorJevTurnGateNoulThreshold",
      "advisorLogFeedback",
      "advisorLoopThreshold",
      "advisorMaxCallsPerSession",
      "advisorModelWhitelist",
      "advisorPlanGate",
      "advisorRedactSecrets",
      "advisorScoutEnabled",
      "advisorScoutTimeoutMs",
      "advisorSessionSummary",
      "advisorToolPolicies",
      "advisorToolResultMaxBytes",
      "advisorToolResultMaxLines",
      "advisorToolsEnabled",
      "advisorTrackedFileContent",
      "advisorUntrackedContent",
      "alwaysOn",
      "contextMaxChars",
      "executor",
      "executorEffort",
      "gateFailureMode",
      "showUsageDetails",
      "showUsageFooter",
      "simpleMode",
    ]);
    expect(SAVED_CONFIG_KEYS).toHaveLength(52);
    expect(CONFIG_SCHEMA.advisorOutcomeLogging.persisted).toBe(false);
  });
});
