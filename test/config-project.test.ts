import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import {
  advisorCollapseResponsesRef,
  advisorEffortRef,
  advisorGitContextMaxCharsRef,
  advisorGitContextRef,
  advisorRedactSecretsRef,
  advisorRef,
  contextMaxCharsRef,
  DEFAULT_ADVISOR_GIT_CONTEXT_MAX_CHARS,
  executorEffortRef,
  executorRef,
  loadConfig,
  resetConfigCache,
  setAdvisorEffortRef,
  setAdvisorRef,
  setContextMaxCharsRef,
  setExecutorEffortRef,
  setExecutorRef,
  simpleModeRef,
} from "../src/config.ts";

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const INVALID_GIT_CONTEXT_PATTERN = /off.*summary.*full/;

describe("Project and repository config rules", () => {
  test("loadConfig ignores invalid repository-controlled project config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-project-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env[AGENT_DIR_ENV];
    const previousConfig = {
      advisor: advisorRef,
      advisorEffort: advisorEffortRef,
      contextMaxChars: contextMaxCharsRef,
      executor: executorRef,
      executorEffort: executorEffortRef,
    };
    const configDir = join(cwd, CONFIG_DIR_NAME);
    mkdirSync(configDir);
    writeFileSync(join(configDir, "advisor.json"), '{"executor":{}}\n');
    writeFileSync(
      join(agentDir, "advisor.json"),
      '{"executor":"global/executor"}\n'
    );
    process.env[AGENT_DIR_ENV] = agentDir;

    try {
      expect(loadConfig({ cwd, isProjectTrusted: () => true } as any)).toBe(
        join(agentDir, "advisor.json")
      );
      expect(executorRef).toBe("global/executor");
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env[AGENT_DIR_ENV];
      } else {
        process.env[AGENT_DIR_ENV] = previousAgentDir;
      }
      setAdvisorRef(previousConfig.advisor);
      setAdvisorEffortRef(previousConfig.advisorEffort);
      setContextMaxCharsRef(previousConfig.contextMaxChars);
      setExecutorRef(previousConfig.executor);
      setExecutorEffortRef(previousConfig.executorEffort);
      rmSync(cwd, { force: true, recursive: true });
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("ignores repository-controlled project configuration", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-project-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env[AGENT_DIR_ENV];
    process.env[AGENT_DIR_ENV] = agentDir;
    mkdirSync(join(cwd, CONFIG_DIR_NAME));
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({
        advisor: "global/advisor",
        advisorRedactSecrets: true,
        simpleMode: false,
      })
    );
    writeFileSync(
      join(cwd, CONFIG_DIR_NAME, "advisor.json"),
      JSON.stringify({
        advisor: "project/advisor",
        advisorCollapseResponses: true,
        advisorRedactSecrets: false,
        simpleMode: true,
      })
    );
    try {
      loadConfig({ cwd, isProjectTrusted: () => true } as any);
      expect(advisorRef).toBe("global/advisor");
      expect(advisorRedactSecretsRef).toBe(true);
      expect(simpleModeRef).toBe(false);
      expect(advisorCollapseResponsesRef).toBe(false);
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env[AGENT_DIR_ENV];
      } else {
        process.env[AGENT_DIR_ENV] = previousAgentDir;
      }
      resetConfigCache();
      rmSync(cwd, { force: true, recursive: true });
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("re-reads a rewritten config that kept its modification time", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env[AGENT_DIR_ENV];
    process.env[AGENT_DIR_ENV] = agentDir;
    const configPath = join(agentDir, "advisor.json");
    const ctx = { cwd: tmpdir(), isProjectTrusted: () => false } as any;

    try {
      writeFileSync(configPath, JSON.stringify({ contextMaxChars: 10_000 }));
      resetConfigCache();
      loadConfig(ctx);
      expect(contextMaxCharsRef).toBe(10_000);
      const { atime, mtime } = statSync(configPath);

      // A same-size external rewrite whose timestamp is restored must not be
      // served from the parsed-configuration cache.
      writeFileSync(configPath, JSON.stringify({ contextMaxChars: 20_000 }));
      utimesSync(configPath, atime, mtime);
      expect(statSync(configPath).mtimeMs).toBe(mtime.getTime());

      loadConfig(ctx);
      expect(contextMaxCharsRef).toBe(20_000);
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env[AGENT_DIR_ENV];
      } else {
        process.env[AGENT_DIR_ENV] = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("defaults repository context to file names only", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env[AGENT_DIR_ENV];
    process.env[AGENT_DIR_ENV] = agentDir;
    writeFileSync(join(agentDir, "advisor.json"), JSON.stringify({}));
    resetConfigCache();

    try {
      loadConfig({ cwd: tmpdir(), isProjectTrusted: () => false } as any);
      expect(advisorGitContextRef).toBe("summary");
      expect(advisorGitContextMaxCharsRef).toBe(
        DEFAULT_ADVISOR_GIT_CONTEXT_MAX_CHARS
      );
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env[AGENT_DIR_ENV];
      } else {
        process.env[AGENT_DIR_ENV] = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("rejects an unknown repository context level", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env[AGENT_DIR_ENV];
    process.env[AGENT_DIR_ENV] = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({ advisorGitContext: "everything" })
    );
    resetConfigCache();

    try {
      expect(() =>
        loadConfig({ cwd: tmpdir(), isProjectTrusted: () => false } as any)
      ).toThrow(INVALID_GIT_CONTEXT_PATTERN);
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env[AGENT_DIR_ENV];
      } else {
        process.env[AGENT_DIR_ENV] = previousAgentDir;
      }
      resetConfigCache();
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("ignores empty model and effort settings", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env[AGENT_DIR_ENV];
    process.env[AGENT_DIR_ENV] = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({
        advisor: "",
        advisorEffort: "",
        executor: "",
        executorEffort: "",
      })
    );

    try {
      loadConfig({ cwd: tmpdir(), isProjectTrusted: () => false } as any);
      expect(executorRef).toBe("");
      expect(advisorRef).toBe("");
      expect(executorEffortRef).toBeUndefined();
      expect(advisorEffortRef).toBeUndefined();
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env[AGENT_DIR_ENV];
      } else {
        process.env[AGENT_DIR_ENV] = previousAgentDir;
      }
      rmSync(agentDir, { force: true, recursive: true });
    }
  });
});
