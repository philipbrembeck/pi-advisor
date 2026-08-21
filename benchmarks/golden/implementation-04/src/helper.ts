export function groupBy<T, K extends PropertyKey>(
  values: readonly T[],
  keyOf: (value: T, index: number) => K
): Map<K, T[]> {
  const result = new Map<K, T[]>();
  values.forEach((value, index) => {
    const key = keyOf(value, index);
    const group = result.get(key);
    if (group) {
      group.push(value);
    } else {
      result.set(key, [value]);
    }
  });
  return result;
}
