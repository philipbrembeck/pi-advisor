import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const INVALID_FAILURE_MODE_PATTERN =
  /block-session.*block-tool.*warn-and-continue/;
const INVALID_TOOL_POLICIES_PATTERN = /advisorToolPolicies/;
const INVALID_GIT_CONTEXT_PATTERN = /off.*summary.*full/;
const INVALID_SCOUT_ENABLED_PATTERN = /advisorScoutEnabled/;
const INVALID_SHOW_USAGE_DETAILS_PATTERN = /showUsageDetails/;
const INVALID_SHOW_USAGE_FOOTER_PATTERN = /showUsageFooter/;

import {
  advisorCollapseResponsesRef,
  advisorEffortRef,
  advisorFailureModeRef,
  advisorGitContextMaxCharsRef,
  advisorGitContextRef,
  advisorHerdrIntegrationRef,
  advisorOutcomeLoggingRef,
  advisorRedactSecretsRef,
  advisorRef,
  advisorScoutEnabledRef,
  advisorSessionSummaryRef,
  advisorToolPoliciesRef,
  advisorToolResultMaxBytesRef,
  advisorToolResultMaxLinesRef,
  advisorTrackedFileContentRef,
  alwaysOnRef,
  contextMaxCharsRef,
  DEFAULT_ADVISOR_GIT_CONTEXT_MAX_CHARS,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES,
  DEFAULT_CONTEXT_MAX_CHARS,
  executorEffortRef,
  executorRef,
  getAdvisorMaxCallsPerSession,
  loadConfig,
  MAX_CONTEXT_MAX_CHARS,
  parseArgs,
  resetConfigCache,
  saveConfig,
  setAdvisorAutoLoopGateRef,
  setAdvisorBlockOnBlockedRef,
  setAdvisorCollapseResponsesRef,
  setAdvisorCompletionGateRef,
  setAdvisorEffortRef,
  setAdvisorFailureGateRef,
  setAdvisorFailureModeRef,
  setAdvisorHerdrIntegrationRef,
  setAdvisorLoopThresholdRef,
  setAdvisorMaxCallsPerSessionRef,
  setAdvisorPlanGateRef,
  setAdvisorRedactSecretsRef,
  setAdvisorRef,
  setAdvisorScoutEnabledRef,
  setAdvisorSessionSummaryRef,
  setAdvisorToolPoliciesRef,
  setAdvisorToolResultMaxBytesRef,
  setAdvisorToolResultMaxLinesRef,
  setAdvisorTrackedFileContentRef,
  setAlwaysOnRef,
  setContextMaxCharsRef,
  setExecutorEffortRef,
  setExecutorRef,
  setShowUsageDetailsRef,
  setShowUsageFooterRef,
  setSimpleModeRef,
  showUsageDetailsRef,
  showUsageFooterRef,
  simpleModeRef,
  splitRef,
  validateConfig,
} from "../src/config.ts";

describe("Config Module", () => {
  test("splitRef should split provider/model", () => {
    const [provider, model] = splitRef("openai/gpt-4");
    expect(provider).toBe("openai");
    expect(model).toBe("gpt-4");
  });

  test("splitRef should use default provider if none provided", () => {
    const [provider, model] = splitRef("gpt-4");
    expect(provider).toBe("openai-codex");
    expect(model).toBe("gpt-4");
  });

  test("parseArgs should parse model and context limit tokens", () => {
    expect(
      parseArgs(
        "executor=openai/gpt-4 advisor=anthropic/claude-3 contextMaxChars=30000"
      )
    ).toBeUndefined();
    expect(executorRef).toBe("openai/gpt-4");
    expect(advisorRef).toBe("anthropic/claude-3");
    expect(contextMaxCharsRef).toBe(30_000);
  });

  test("parseArgs rejects invalid context limits without changing configuration", () => {
    setContextMaxCharsRef(DEFAULT_CONTEXT_MAX_CHARS);
    const executorBefore = executorRef;
    const advisorBefore = advisorRef;
    expect(
      parseArgs("executor=other/model advisor=other/advisor contextMaxChars=-1")
    ).toContain("non-negative integer");
    expect(executorRef).toBe(executorBefore);
    expect(advisorRef).toBe(advisorBefore);
    expect(contextMaxCharsRef).toBe(DEFAULT_CONTEXT_MAX_CHARS);
    expect(parseArgs(`contextMaxChars=${MAX_CONTEXT_MAX_CHARS + 1}`)).toContain(
      String(MAX_CONTEXT_MAX_CHARS)
    );
    expect(contextMaxCharsRef).toBe(DEFAULT_CONTEXT_MAX_CHARS);
  });

  test("parseArgs accepts zero as a no-history context cap", () => {
    expect(parseArgs("contextMaxChars=0")).toBeUndefined();
    expect(contextMaxCharsRef).toBe(0);
  });

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

  test("uses safe defaults and validates known configuration keys", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env[AGENT_DIR_ENV];
    process.env[AGENT_DIR_ENV] = agentDir;

    try {
      resetConfigCache();
      loadConfig({ cwd: tmpdir(), isProjectTrusted: () => false } as any);
      expect(advisorFailureModeRef).toBe("block-session");
      expect(simpleModeRef).toBe(false);
      expect(alwaysOnRef).toBe(false);
      expect(advisorSessionSummaryRef).toBe(false);
      expect(advisorScoutEnabledRef).toBe(false);
      expect(showUsageDetailsRef).toBe(true);
      expect(showUsageFooterRef).toBe(false);
      expect(advisorHerdrIntegrationRef).toBe(true);
      expect(validateConfig({ advisorScoutEnabled: true })).toBe(true);
      expect(validateConfig({ showUsageDetails: false })).toBe(true);
      expect(validateConfig({ showUsageFooter: true })).toBe(true);
      expect(() => validateConfig({ showUsageDetails: "yes" })).toThrow(
        INVALID_SHOW_USAGE_DETAILS_PATTERN
      );
      expect(() => validateConfig({ showUsageFooter: "yes" })).toThrow(
        INVALID_SHOW_USAGE_FOOTER_PATTERN
      );
      expect(() => validateConfig({ advisorScoutEnabled: "yes" })).toThrow(
        INVALID_SCOUT_ENABLED_PATTERN
      );
      expect(advisorToolResultMaxLinesRef).toBe(
        DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES
      );
      expect(advisorToolResultMaxBytesRef).toBe(
        DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES
      );
      expect(advisorRedactSecretsRef).toBe(false);
      expect(advisorTrackedFileContentRef).toBe(false);
      expect(advisorToolPoliciesRef).toEqual({});
      expect(validateConfig({ unexpected: true }, "/tmp/advisor.json")).toBe(
        true
      );
      expect(() =>
        validateConfig({ gateFailureMode: "bad" }, "/tmp/advisor.json")
      ).toThrow(INVALID_FAILURE_MODE_PATTERN);
      for (const invalid of [[], { bash: "invalid" }, { "": "full" }]) {
        expect(() => validateConfig({ advisorToolPolicies: invalid })).toThrow(
          INVALID_TOOL_POLICIES_PATTERN
        );
      }
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

  test("reads live finite and unlimited budget transitions", () => {
    setAdvisorMaxCallsPerSessionRef(5);
    expect(getAdvisorMaxCallsPerSession()).toBe(5);
    setAdvisorMaxCallsPerSessionRef(undefined);
    expect(getAdvisorMaxCallsPerSession()).toBeUndefined();
    setAdvisorMaxCallsPerSessionRef(2);
    expect(getAdvisorMaxCallsPerSession()).toBe(2);
    setAdvisorMaxCallsPerSessionRef(undefined);
  });

  test("saveConfig removes a previous finite budget when unlimited", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-project-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env[AGENT_DIR_ENV];
    process.env[AGENT_DIR_ENV] = agentDir;
    writeFileSync(
      join(agentDir, "advisor.json"),
      '{"advisorMaxCallsPerSession":5}\n'
    );

    try {
      setAdvisorMaxCallsPerSessionRef(undefined);
      const path = saveConfig({ cwd, isProjectTrusted: () => false } as any);
      expect(JSON.parse(readFileSync(path, "utf8"))).not.toHaveProperty(
        "advisorMaxCallsPerSession"
      );
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env[AGENT_DIR_ENV];
      } else {
        process.env[AGENT_DIR_ENV] = previousAgentDir;
      }
      rmSync(cwd, { force: true, recursive: true });
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("project configuration cannot enable global-only outcome logging", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-project-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env[AGENT_DIR_ENV];
    process.env[AGENT_DIR_ENV] = agentDir;
    mkdirSync(join(cwd, CONFIG_DIR_NAME));
    writeFileSync(
      join(cwd, CONFIG_DIR_NAME, "advisor.json"),
      JSON.stringify({ advisorOutcomeLogging: true })
    );
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({ advisorOutcomeLogging: false })
    );
    resetConfigCache();
    try {
      loadConfig({ cwd, isProjectTrusted: () => true } as any);
      expect(advisorOutcomeLoggingRef).toBe(false);
      writeFileSync(
        join(agentDir, "advisor.json"),
        JSON.stringify({ advisorOutcomeLogging: true })
      );
      resetConfigCache();
      loadConfig({ cwd, isProjectTrusted: () => true } as any);
      expect(advisorOutcomeLoggingRef).toBe(true);
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

  test("Scout is global-only and defaults off", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-project-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env[AGENT_DIR_ENV];
    process.env[AGENT_DIR_ENV] = agentDir;
    mkdirSync(join(cwd, CONFIG_DIR_NAME));
    writeFileSync(
      join(cwd, CONFIG_DIR_NAME, "advisor.json"),
      JSON.stringify({ advisorScoutEnabled: true })
    );
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({ advisorScoutEnabled: false })
    );
    resetConfigCache();
    try {
      loadConfig({ cwd, isProjectTrusted: () => true } as any);
      expect(advisorScoutEnabledRef).toBe(false);
      writeFileSync(
        join(agentDir, "advisor.json"),
        JSON.stringify({ advisorScoutEnabled: true })
      );
      resetConfigCache();
      loadConfig({ cwd, isProjectTrusted: () => true } as any);
      expect(advisorScoutEnabledRef).toBe(true);
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

  test("saveConfig preserves unknown fields", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-project-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
    const previousAgentDir = process.env[AGENT_DIR_ENV];
    process.env[AGENT_DIR_ENV] = agentDir;
    writeFileSync(join(agentDir, "advisor.json"), '{"futureSetting":true}\n');

    try {
      setContextMaxCharsRef(Number.MAX_SAFE_INTEGER);
      setAdvisorPlanGateRef(false);
      setAdvisorFailureGateRef(false);
      setAdvisorCompletionGateRef(false);
      setAdvisorCollapseResponsesRef(true);
      setAdvisorBlockOnBlockedRef(false);
      setAdvisorAutoLoopGateRef(false);
      setAdvisorLoopThresholdRef(5);
      setAdvisorMaxCallsPerSessionRef(2);
      setAdvisorSessionSummaryRef(false);
      setAdvisorScoutEnabledRef(true);
      setShowUsageDetailsRef(false);
      setShowUsageFooterRef(true);
      setSimpleModeRef(true);
      setAlwaysOnRef(true);
      setAdvisorFailureModeRef("warn-and-continue");
      setAdvisorHerdrIntegrationRef(false);
      setAdvisorToolResultMaxLinesRef(100);
      setAdvisorToolResultMaxBytesRef(10_240);
      setAdvisorRedactSecretsRef(true);
      setAdvisorToolPoliciesRef({ bash: "summary", deploy: "exclude" });
      setAdvisorTrackedFileContentRef(true);
      const path = saveConfig({ cwd, isProjectTrusted: () => false } as any);
      expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
        advisorAutoLoopGate: false,
        advisorBlockOnBlocked: false,
        advisorCollapseResponses: true,
        advisorCompletionGate: false,
        advisorFailureGate: false,
        advisorHerdrIntegration: false,
        advisorLoopThreshold: 5,
        advisorMaxCallsPerSession: 2,
        advisorPlanGate: false,
        advisorRedactSecrets: true,
        advisorScoutEnabled: true,
        advisorSessionSummary: false,
        advisorToolPolicies: { bash: "summary", deploy: "exclude" },
        advisorToolResultMaxBytes: 10_240,
        advisorToolResultMaxLines: 100,
        advisorTrackedFileContent: true,
        alwaysOn: true,
        contextMaxChars: Number.MAX_SAFE_INTEGER,
        futureSetting: true,
        gateFailureMode: "warn-and-continue",
        showUsageDetails: false,
        showUsageFooter: true,
        simpleMode: true,
      });

      const warnings: string[] = [];
      const ctx = {
        cwd,
        hasUI: true,
        isProjectTrusted: () => false,
        ui: { notify: (message: string) => warnings.push(message) },
      } as any;
      expect(() => loadConfig(ctx)).not.toThrow();
      expect(() => loadConfig(ctx)).not.toThrow();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("futureSetting");
      expect(contextMaxCharsRef).toBe(Number.MAX_SAFE_INTEGER);
      expect(showUsageDetailsRef).toBe(false);
      expect(showUsageFooterRef).toBe(true);
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env[AGENT_DIR_ENV];
      } else {
        process.env[AGENT_DIR_ENV] = previousAgentDir;
      }
      rmSync(cwd, { force: true, recursive: true });
      rmSync(agentDir, { force: true, recursive: true });
    }
  });
});
