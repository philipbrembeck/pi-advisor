import { modePolicy } from "./config.js";
import type { BenchmarkMode } from "./types.js";

export const activeToolsForMode = (
  mode: BenchmarkMode,
  configuredTools: string[]
) =>
  modePolicy(mode).advisorToolAvailable
    ? [...configuredTools, "ask_advisor"]
    : [...configuredTools];
