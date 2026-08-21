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
  _base: Settings,
  _override: Partial<Settings>
): Settings {
  throw new Error("not implemented");
}
