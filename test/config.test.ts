import { expect, test, describe } from "bun:test";
import { splitRef, parseArgs, executorRef, advisorRef } from "../src/config.js";

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

  test("parseArgs should parse key=value tokens", () => {
    parseArgs("executor=openai/gpt-4 advisor=anthropic/claude-3");
    expect(executorRef).toBe("openai/gpt-4");
    expect(advisorRef).toBe("anthropic/claude-3");
  });
});
