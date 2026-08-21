export interface Settings {
  headers: Record<string, string>;
  retries: number;
  tags: string[];
  timeoutMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  headers: {},
  retries: 2,
  tags: [],
  timeoutMs: 5000,
};

export function mergeSettings(
  base: Settings,
  override: Partial<Settings>
): Settings {
  let tags = [...base.tags];
  if (override.tags !== undefined) {
    if (override.tags.length === 0) {
      tags = [];
    } else {
      tags = [...new Set([...base.tags, ...override.tags])];
    }
  }
  return {
    headers: { ...base.headers, ...(override.headers ?? {}) },
    retries: override.retries ?? base.retries,
    tags,
    timeoutMs: override.timeoutMs ?? base.timeoutMs,
  };
}
