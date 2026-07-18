import { expect, test, describe } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
import {
  DEFAULT_CONTEXT_MAX_CHARS,
  MAX_CONTEXT_MAX_CHARS,
  splitRef,
  parseArgs,
  executorRef,
  advisorRef,
  executorEffortRef,
  advisorEffortRef,
  contextMaxCharsRef,
  loadConfig,
  saveConfig,
  setAdvisorCollapseResponsesRef,
  setAdvisorCompletionGateRef,
  setAdvisorEffortRef,
  setAdvisorFailureGateRef,
  setAdvisorPlanGateRef,
  setAdvisorRef,
  setContextMaxCharsRef,
  setExecutorEffortRef,
  setExecutorRef,
} from "../src/config.js";

describe("Config Module", () => {
  test("splitRef should split provider/model", () => {
    const [provider, model] = splitRef("openai/gpt-4");
    expect(provider).toBe("openai");
    expect(model).toBe("gpt-4");
  });

  test("splitRef should use default provider if none provided", () => {
    const [provider, model] = splitRef("gpt-4");
    expect(provider).toBe("aikeys");
    expect(model).toBe("gpt-4");
  });

  test("parseArgs should parse model and context limit tokens", () => {
    expect(parseArgs("executor=openai/gpt-4 advisor=anthropic/claude-3 contextMaxChars=30000")).toBeUndefined();
    expect(executorRef).toBe("openai/gpt-4");
    expect(advisorRef).toBe("anthropic/claude-3");
    expect(contextMaxCharsRef).toBe(30_000);
  });

  test("parseArgs rejects invalid context limits without changing configuration", () => {
    setContextMaxCharsRef(DEFAULT_CONTEXT_MAX_CHARS);
    const executorBefore = executorRef;
    const advisorBefore = advisorRef;
    expect(parseArgs("executor=other/model advisor=other/advisor contextMaxChars=-1")).toContain("non-negative integer");
    expect(executorRef).toBe(executorBefore);
    expect(advisorRef).toBe(advisorBefore);
    expect(contextMaxCharsRef).toBe(DEFAULT_CONTEXT_MAX_CHARS);
    expect(parseArgs(`contextMaxChars=${MAX_CONTEXT_MAX_CHARS + 1}`)).toContain(String(MAX_CONTEXT_MAX_CHARS));
    expect(contextMaxCharsRef).toBe(DEFAULT_CONTEXT_MAX_CHARS);
  });

  test("parseArgs accepts zero as a no-history context cap", () => {
    expect(parseArgs("contextMaxChars=0")).toBeUndefined();
    expect(contextMaxCharsRef).toBe(0);
  });

  test("loadConfig ignores a parseable config with invalid field types", () => {
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
    writeFileSync(join(agentDir, "advisor.json"), '{"executor":"global/executor"}\n');
    process.env[AGENT_DIR_ENV] = agentDir;

    try {
      loadConfig({ cwd, isProjectTrusted: () => true } as any);
      expect(executorRef).toBe("global/executor");
      expect(() => splitRef(executorRef)).not.toThrow();
    } finally {
      if (previousAgentDir === undefined) delete process.env[AGENT_DIR_ENV];
      else process.env[AGENT_DIR_ENV] = previousAgentDir;
      setAdvisorRef(previousConfig.advisor);
      setAdvisorEffortRef(previousConfig.advisorEffort);
      setContextMaxCharsRef(previousConfig.contextMaxChars);
      setExecutorRef(previousConfig.executor);
      setExecutorEffortRef(previousConfig.executorEffort);
      rmSync(cwd, { recursive: true, force: true });
      rmSync(agentDir, { recursive: true, force: true });
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
      const path = saveConfig({ cwd, isProjectTrusted: () => false } as any);
      expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
        futureSetting: true,
        contextMaxChars: Number.MAX_SAFE_INTEGER,
        advisorPlanGate: false,
        advisorFailureGate: false,
        advisorCompletionGate: false,
        advisorCollapseResponses: true,
      });
    } finally {
      if (previousAgentDir === undefined) delete process.env[AGENT_DIR_ENV];
      else process.env[AGENT_DIR_ENV] = previousAgentDir;
      rmSync(cwd, { recursive: true, force: true });
      rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
