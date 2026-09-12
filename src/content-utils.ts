/** Shared untyped-content inspection helpers. */

export type RecordValue = Record<string, unknown>;

export const isRecord = (value: unknown): value is RecordValue =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const byteLength = (value: string) => Buffer.byteLength(value, "utf8");

export const contentParts = (content: unknown): unknown[] => {
  if (typeof content === "string") {
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
