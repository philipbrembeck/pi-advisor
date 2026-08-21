const values = new Map<string, number>();
const listeners = new Map<string, Set<(value: number) => void>>();
export function set(key: string, value: number) {
  values.set(key, value);
  for (const listener of listeners.get(key) ?? []) {
    listener(value);
  }
}
export function get(key: string) {
  return values.get(key);
}
export function subscribe(key: string, listener: (value: number) => void) {
  const bucket = listeners.get(key) ?? new Set<(value: number) => void>();
  bucket.add(listener);
  listeners.set(key, bucket);
  return () => {
    bucket.delete(listener);
  };
}
