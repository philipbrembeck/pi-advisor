const values = new Map<string, string>();
const invalidated = new Set<string>();

export function setValue(key: string, value: string) {
  values.set(key, value);
  // bug: a key invalidated earlier remains hidden after a refresh
}

export function getValue(key: string): string | undefined {
  return invalidated.has(key) ? undefined : values.get(key);
}

export function invalidate(_key: string) {
  invalidated.add(_key);
}
