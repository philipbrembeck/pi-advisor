import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

import {
  advisorEffortRef,
  advisorFailureModeRef,
  advisorHerdrIntegrationRef,
  advisorRef,
  advisorToolResultMaxBytesRef,
  advisorToolResultMaxLinesRef,
  contextMaxCharsRef,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES,
  DEFAULT_CONTEXT_MAX_CHARS,
  executorEffortRef,
  executorRef,
  loadConfig,
  MAX_CONTEXT_MAX_CHARS,
  parseArgs,
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
  setAdvisorRef,
  setAdvisorSessionSummaryRef,
  setAdvisorToolResultMaxBytesRef,
  setAdvisorToolResultMaxLinesRef,
  setContextMaxCharsRef,
  setExecutorEffortRef,
  setExecutorRef,
  splitRef,
  validateConfig,
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

  test("loadConfig rejects a parseable config with invalid field types", () => {
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
      expect(() =>
        loadConfig({ cwd, isProjectTrusted: () => true } as any)
      ).toThrow(/executor.*provider\/model string/);
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

  test("uses safe defaults and rejects unknown configuration keys with remediation", () => {
    expect(advisorFailureModeRef).toBe("block-session");
    expect(advisorHerdrIntegrationRef).toBe(true);
    expect(advisorToolResultMaxLinesRef).toBe(
      DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES
    );
    expect(advisorToolResultMaxBytesRef).toBe(
      DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES
    );
    expect(() =>
      validateConfig({ unexpected: true }, "/tmp/advisor.json")
    ).toThrow(/unknown key.*unexpected/);
    expect(() =>
      validateConfig({ gateFailureMode: "bad" }, "/tmp/advisor.json")
    ).toThrow(/block-session.*block-tool.*warn-and-continue/);
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
      setAdvisorFailureModeRef("warn-and-continue");
      setAdvisorHerdrIntegrationRef(false);
      setAdvisorToolResultMaxLinesRef(100);
      setAdvisorToolResultMaxBytesRef(10_240);
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
        advisorSessionSummary: false,
        advisorToolResultMaxBytes: 10_240,
        advisorToolResultMaxLines: 100,
        contextMaxChars: Number.MAX_SAFE_INTEGER,
        futureSetting: true,
        gateFailureMode: "warn-and-continue",
      });
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
