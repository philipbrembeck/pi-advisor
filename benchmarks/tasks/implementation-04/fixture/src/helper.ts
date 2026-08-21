export function groupBy<T, K extends PropertyKey>(
  _values: readonly T[],
  _keyOf: (value: T, index: number) => K
): Map<K, T[]> {
  throw new Error("not implemented");
}
