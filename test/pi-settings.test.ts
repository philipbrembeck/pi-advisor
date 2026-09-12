import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { piHideThinkingEnabled } from "../src/pi-settings.ts";

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

const withAgentSettings = async (
  settings: Record<string, unknown> | null,
  run: () => Promise<void> | void
) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-pi-settings-"));
  const previousAgentDir = process.env[AGENT_DIR_ENV];
  process.env[AGENT_DIR_ENV] = agentDir;
  if (settings !== null) {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify(settings, null, 2)
    );
  }
  try {
    await run();
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env[AGENT_DIR_ENV];
    } else {
      process.env[AGENT_DIR_ENV] = previousAgentDir;
    }
    rmSync(agentDir, { force: true, recursive: true });
  }
};

describe("Pi global settings reader", () => {
  test("reports hide_thinking when enabled", async () => {
    await withAgentSettings({ hideThinkingBlock: true }, () => {
      expect(piHideThinkingEnabled()).toBe(true);
    });
  });

  test("defaults to visible when unset or disabled", async () => {
    await withAgentSettings({}, () => {
      expect(piHideThinkingEnabled()).toBe(false);
    });
    await withAgentSettings({ hideThinkingBlock: false }, () => {
      expect(piHideThinkingEnabled()).toBe(false);
    });
  });

  test("defaults to visible without a settings file", async () => {
    await withAgentSettings(null, () => {
      expect(piHideThinkingEnabled()).toBe(false);
    });
  });
});
