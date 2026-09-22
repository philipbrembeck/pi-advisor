import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetConfigCache } from "../../src/config.ts";
import type { AdvisorConfig } from "../../src/config/types.ts";
import type { JsonValue } from "./extension-context.ts";

/** Advisor settings plus arbitrary JSON keys persisted alongside them. */
export type AdvisorConfigFixture = AdvisorConfig & Record<string, JsonValue>;

/**
 * Runs `run` with PI_CODING_AGENT_DIR pointed at a fresh agent directory
 * seeded with `config` as advisor.json. Restores the environment variable,
 * resets the config cache, and removes the directory in `finally`.
 */
export const withAgentDir = async (
  config: AdvisorConfigFixture,
  run: (agentDir: string) => Promise<void> | void
) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-agent-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  writeFileSync(
    join(agentDir, "advisor.json"),
    JSON.stringify(config, null, 2)
  );
  resetConfigCache();
  try {
    await run(agentDir);
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    resetConfigCache();
    rmSync(agentDir, { force: true, recursive: true });
  }
};

/** PI_CODING_AGENT_DIR while a withAgentDir callback runs. */
// SAFETY: withAgentDir always defines PI_CODING_AGENT_DIR while `run` executes.
export const agentDir = () => process.env.PI_CODING_AGENT_DIR as string;

/** Reads the advisor.json currently persisted under `dir`. */
export const savedConfig = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "advisor.json"), "utf-8"));
