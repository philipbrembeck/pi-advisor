/** Shared untyped-content inspection helpers. */

export interface RecordValue {
  [key: string]: unknown;
}

export const isRecord = (value: unknown): value is RecordValue =>
  Boolean(value) && typeof value === "object";

export const byteLength = (value: string) => Buffer.byteLength(value, "utf8");

export const contentParts = (content: unknown): unknown[] =>
  Array.isArray(content) ? content : [];
