export interface MemoOptions {
  maxEntries?: number;
}

export function memoize<TArgs extends readonly unknown[], TResult>(
  _fn: (...args: TArgs) => TResult,
  _options: MemoOptions = {}
): (...args: TArgs) => TResult {
  throw new Error("not implemented");
}
