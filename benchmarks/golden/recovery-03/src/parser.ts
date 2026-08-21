/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: golden parser intentionally exercises all recovery branches. */
export interface Config {
  enabled?: boolean;
  mode?: string;
  retries?: number;
}
export function parseConfig(input: string): Config {
  const out: Config = {};
  for (const raw of input.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const at = line.indexOf("=");
    if (at <= 0) {
      continue;
    }
    const key = line.slice(0, at).trim();
    const rawValue = line.slice(at + 1);
    const value =
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue;
    if (key === "retries") {
      const n = Number(value);
      if (Number.isInteger(n) && n >= 0) {
        out.retries = n;
      }
    } else if (key === "mode") {
      out.mode = value;
    } else if (key === "enabled" && (value === "true" || value === "false")) {
      out.enabled = value === "true";
    }
  }
  return out;
}
