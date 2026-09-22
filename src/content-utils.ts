/** Shared untyped-content inspection helpers. */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type RecordValue = Record<string, JsonValue>;

export const isRecord = (value: unknown): value is RecordValue =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const isRecordOf = <Value>(value: Value): value is Value & RecordValue =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const isString = <Value>(value: Value): value is Value & string =>
  typeof value === "string";

export const isNumber = <Value>(value: Value): value is Value & number =>
  typeof value === "number";

export const isBoolean = <Value>(value: Value): value is Value & boolean =>
  typeof value === "boolean";

export const byteLength = (value: string) => Buffer.byteLength(value, "utf-8");

export const contentParts = <Content>(content: Content): unknown[] => {
  if (isString(content)) {
    return [content];
  }
  return Array.isArray(content) ? content : [];
};

/** Longest UTF-8 prefix of `value` within `maxBytes`, in linear time. */
export const capUtf8Bytes = (value: string, maxBytes: number): string => {
  let result = "";
  let used = 0;
  for (const character of value) {
    const characterBytes = byteLength(character);
    if (used + characterBytes > maxBytes) {
      break;
    }
    result += character;
    used += characterBytes;
  }
  return result;
};
