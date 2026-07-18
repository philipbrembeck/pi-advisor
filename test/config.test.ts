import { expect, test, describe } from "bun:test";
import {
  DEFAULT_CONTEXT_MAX_CHARS,
  MAX_CONTEXT_MAX_CHARS,
  splitRef,
  parseArgs,
  executorRef,
  advisorRef,
  contextMaxCharsRef,
  setContextMaxCharsRef,
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
    expect(parseArgs("executor=other/model advisor=other/advisor contextMaxChars=0")).toContain("positive integer");
    expect(executorRef).toBe(executorBefore);
    expect(advisorRef).toBe(advisorBefore);
    expect(contextMaxCharsRef).toBe(DEFAULT_CONTEXT_MAX_CHARS);
    expect(parseArgs(`contextMaxChars=${MAX_CONTEXT_MAX_CHARS + 1}`)).toContain(String(MAX_CONTEXT_MAX_CHARS));
    expect(contextMaxCharsRef).toBe(DEFAULT_CONTEXT_MAX_CHARS);
  });
});
