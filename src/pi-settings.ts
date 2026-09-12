import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

interface PiGlobalSettings {
  hideThinkingBlock?: boolean;
}

interface CachedSetting {
  hidden: boolean;
  identity: string;
  readAt: number;
}

// Cached per file and re-read on identity change; stat calls are rate-limited because renderers run per frame.
const SETTING_RECHECK_INTERVAL_MS = 2000;
const cache = new Map<string, CachedSetting>();

const settingsIdentity = (path: string): string => {
  try {
    const stats = statSync(path, { bigint: true });
    return `${stats.mtimeNs}:${stats.ctimeNs}:${stats.size}:${stats.ino}`;
  } catch {
    return `unstattable:${process.hrtime.bigint()}`;
  }
};

const readHideThinking = (path: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as PiGlobalSettings).hideThinkingBlock === true
    );
  } catch {
    return false;
  }
};

/** Whether Pi's `hide_thinking` setting hides rendered thinking blocks. */
export const piHideThinkingEnabled = (): boolean => {
  const path = join(getAgentDir(), "settings.json");
  if (!existsSync(path)) {
    return false;
  }
  const now = Date.now();
  const cached = cache.get(path);
  if (cached && now - cached.readAt < SETTING_RECHECK_INTERVAL_MS) {
    return cached.hidden;
  }
  const identity = settingsIdentity(path);
  const hidden =
    cached && cached.identity === identity
      ? cached.hidden
      : readHideThinking(path);
  cache.set(path, { hidden, identity, readAt: now });
  return hidden;
};
