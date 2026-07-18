import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";

export const FALLBACK_EXECUTOR = "aikeys/claude-sonnet-5";
export const FALLBACK_ADVISOR = "aikeys/claude-fable-5";
export const DEFAULT_CONTEXT_MAX_CHARS = 15_000;
export const MAX_CONTEXT_MAX_CHARS = 1_000_000;

export let executorRef = FALLBACK_EXECUTOR;
export let advisorRef = FALLBACK_ADVISOR;
export let executorEffortRef: string | undefined = undefined;
export let advisorEffortRef: string | undefined = undefined;
export let contextMaxCharsRef = DEFAULT_CONTEXT_MAX_CHARS;

export const setExecutorRef = (ref: string) => { executorRef = ref; };
export const setAdvisorRef = (ref: string) => { advisorRef = ref; };
export const setExecutorEffortRef = (effort: string | undefined) => { executorEffortRef = effort; };
export const setAdvisorEffortRef = (effort: string | undefined) => { advisorEffortRef = effort; };
export const isValidContextMaxChars = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_CONTEXT_MAX_CHARS;
export const setContextMaxCharsRef = (value: number) => { contextMaxCharsRef = value; };

export const splitRef = (ref: string): [string, string] => {
  const i = ref.indexOf("/");
  return i === -1 ? ["aikeys", ref] : [ref.slice(0, i), ref.slice(i + 1)];
};

export const configPaths = (ctx: ExtensionContext) => [
  ctx.isProjectTrusted() ? join(ctx.cwd, CONFIG_DIR_NAME, "advisor.json") : null,
  join(getAgentDir(), "advisor.json"),
];

export const loadConfig = (ctx: ExtensionContext) => {
  executorRef = FALLBACK_EXECUTOR;
  advisorRef = FALLBACK_ADVISOR;
  executorEffortRef = undefined;
  advisorEffortRef = undefined;
  contextMaxCharsRef = DEFAULT_CONTEXT_MAX_CHARS;
  for (const path of configPaths(ctx)) {
    if (!path || !existsSync(path)) continue;
    try {
      const config = JSON.parse(readFileSync(path, "utf8")) as {
        executor?: string;
        advisor?: string;
        executorEffort?: string;
        advisorEffort?: string;
        contextMaxChars?: number;
      };
      if (config.executor) executorRef = config.executor;
      if (config.advisor) advisorRef = config.advisor;
      if (config.executorEffort) executorEffortRef = config.executorEffort;
      if (config.advisorEffort) advisorEffortRef = config.advisorEffort;
      if (isValidContextMaxChars(config.contextMaxChars)) contextMaxCharsRef = config.contextMaxChars;
      return path;
    } catch {
      // Ignore malformed config and keep looking for a valid fallback.
    }
  }
  return null;
};

export const saveConfig = (ctx: ExtensionContext) => {
  const project = join(ctx.cwd, CONFIG_DIR_NAME, "advisor.json");
  const path = ctx.isProjectTrusted() && existsSync(project) ? project : join(getAgentDir(), "advisor.json");
  const data = {
    executor: executorRef,
    advisor: advisorRef,
    executorEffort: executorEffortRef,
    advisorEffort: advisorEffortRef,
    contextMaxChars: contextMaxCharsRef,
  };
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
};

export const parseArgs = (args: string): string | undefined => {
  let nextExecutor = executorRef;
  let nextAdvisor = advisorRef;
  let nextContextMaxChars = contextMaxCharsRef;

  for (const token of args.trim().split(/\s+/).filter(Boolean)) {
    const [key, value] = token.split("=");
    if (key === "executor" && value) nextExecutor = value;
    if (key === "advisor" && value) nextAdvisor = value;
    if (key === "contextMaxChars") {
      const parsed = Number(value);
      if (!isValidContextMaxChars(parsed)) {
        return `contextMaxChars must be a positive integer no greater than ${MAX_CONTEXT_MAX_CHARS}.`;
      }
      nextContextMaxChars = parsed;
    }
  }

  executorRef = nextExecutor;
  advisorRef = nextAdvisor;
  contextMaxCharsRef = nextContextMaxChars;
  return undefined;
};
