const values = new Map<string, string>();
const invalidated = new Set<string>();
export function setValue(key: string, value: string) {
  values.set(key, value);
  invalidated.delete(key);
}
export function getValue(key: string): string | undefined {
  return invalidated.has(key) ? undefined : values.get(key);
}
export function invalidate(key: string) {
  invalidated.add(key);
  values.delete(key);
}
