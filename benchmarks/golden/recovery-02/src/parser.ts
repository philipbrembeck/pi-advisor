const SEPARATOR = /(?<=\d)_(?=\d)/g;
const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
export function parse(input: string): number | undefined {
  const value = input.trim().replace(SEPARATOR, "");
  if (!NUMBER.test(value)) {
    return undefined;
  }
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}
