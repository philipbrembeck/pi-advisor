import {
  advisorRef,
  contextMaxCharsRef,
  executorRef,
  setAdvisorRef,
  setContextMaxCharsRef,
  setExecutorRef,
} from "./state.js";
import { MAX_CONTEXT_MAX_CHARS } from "./types.js";
import { isValidContextMaxChars } from "./validation.js";

const ARGUMENT_WHITESPACE = /\s+/;

export const parseArgs = (args: string): string | undefined => {
  let nextExecutor = executorRef;
  let nextAdvisor = advisorRef;
  let nextContextMaxChars = contextMaxCharsRef;
  for (const token of args.trim().split(ARGUMENT_WHITESPACE).filter(Boolean)) {
    const [key, value] = token.split("=");
    if (key === "executor" && value) {
      nextExecutor = value;
    }
    if (key === "advisor" && value) {
      nextAdvisor = value;
    }
    if (key === "contextMaxChars") {
      const parsed = Number(value);
      if (!isValidContextMaxChars(parsed)) {
        return `contextMaxChars must be a non-negative integer no greater than ${MAX_CONTEXT_MAX_CHARS}.`;
      }
      nextContextMaxChars = parsed;
    }
  }
  setExecutorRef(nextExecutor);
  setAdvisorRef(nextAdvisor);
  setContextMaxCharsRef(nextContextMaxChars);
};
