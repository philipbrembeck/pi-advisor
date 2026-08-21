export interface MemoOptions {
  maxEntries?: number;
}
export function memoize<TArgs extends readonly unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
  options: MemoOptions = {}
): (...args: TArgs) => TResult {
  const cache = new Map<string, TResult>();
  const max = options.maxEntries ?? Number.POSITIVE_INFINITY;
  return (...args: TArgs) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      const value = cache.get(key) as TResult;
      cache.delete(key);
      cache.set(key, value);
      return value;
    }
    const value = fn(...args);
    if (max > 0) {
      cache.set(key, value);
      while (cache.size > max) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) {
          cache.delete(firstKey);
        }
      }
    }
    return value;
  };
}
