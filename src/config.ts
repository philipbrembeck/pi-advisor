import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";

export const FALLBACK_EXECUTOR = "aikeys/claude-sonnet-5";
export const FALLBACK_ADVISOR = "aikeys/claude-fable-5";

export let executorRef = FALLBACK_EXECUTOR;
export let advisorRef = FALLBACK_ADVISOR;
export let executorEffortRef: string | undefined = undefined;
export let advisorEffortRef: string | undefined = undefined;

export const setExecutorRef = (ref: string) => { executorRef = ref; };
export const setAdvisorRef = (ref: string) => { advisorRef = ref; };
export const setExecutorEffortRef = (effort: string | undefined) => { executorEffortRef = effort; };
export const setAdvisorEffortRef = (effort: string | undefined) => { advisorEffortRef = effort; };

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
  for (const path of configPaths(ctx)) {
    if (!path || !existsSync(path)) continue;
    try {
      const config = JSON.parse(readFileSync(path, "utf8")) as {
        executor?: string;
        advisor?: string;
        executorEffort?: string;
        advisorEffort?: string;
      };
      if (config.executor) executorRef = config.executor;
      if (config.advisor) advisorRef = config.advisor;
      if (config.executorEffort) executorEffortRef = config.executorEffort;
      if (config.advisorEffort) advisorEffortRef = config.advisorEffort;
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
  };
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
};

export const parseArgs = (args: string) => {
  for (const token of args.trim().split(/\s+/).filter(Boolean)) {
    const [key, value] = token.split("=");
    if (key === "executor" && value) executorRef = value;
    if (key === "advisor" && value) advisorRef = value;
  }
};
