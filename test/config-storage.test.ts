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
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  setAdvisorEffortRef,
  setAdvisorRef,
  setExecutorEffortRef,
  setExecutorRef,
  setShowUsageFooterRef,
} from "../src/config/state.ts";
import {
  loadConfig,
  resetConfigCache,
  saveConfig,
} from "../src/config/storage.ts";

const context = { hasUI: false } as unknown as ExtensionContext;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
let agentDir = "";

const configPath = () => join(agentDir, "advisor.json");
const readSavedConfig = () =>
  JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;

describe("Advisor config persistence", () => {
  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-flow-test-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
  });

  afterEach(() => {
    resetConfigCache();
    rmSync(agentDir, { force: true, recursive: true });
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
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
