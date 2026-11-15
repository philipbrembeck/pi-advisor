import { isRecordOf, isString } from "./content-utils.ts";
import type { JsonValue } from "./content-utils.ts";

const WHITESPACE = /\s/u;

const TIMESTAMP_KEYS = new Set([
  "createdat",
  "date",
  "datetime",
  "time",
  "timestamp",
  "updatedat",
]);

const REQUEST_ID_KEYS = new Set(["correlationid", "requestid", "traceid"]);

const normalizedKey = (key: string) =>
  key.replaceAll(/[-_]/gu, "").toLowerCase();

const isVolatileKey = (key: string, keys: Set<string>) =>
  keys.has(normalizedKey(key));

const normalizeShellWhitespace = (command: string) => {
  let result = "";
  let quote: "'" | '"' | "`" | undefined;
  let pendingSpace = false;

  for (const char of command.trim()) {
    if (quote) {
      result += char;

      if (char === quote) {
        quote = undefined;
      }

      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      if (pendingSpace && result) {
        result += " ";
      }

      pendingSpace = false;
      quote = char;
      result += char;
    } else if (WHITESPACE.test(char)) {
      pendingSpace = true;
    } else {
      if (pendingSpace && result) {
        result += " ";
      }

      pendingSpace = false;
      result += char;
    }
  }

  return result;
};

const normalizeString = (value: string) =>
  value
    .replaceAll(/\/(?:private\/)?tmp\/[^\s/]+/gu, "/tmp/<temporary>")
    .replaceAll(/\/var\/folders\/[^\s/]+/gu, "/var/folders/<temporary>");

export type NormalizedToolInput =
  | JsonValue
  | undefined
  | NormalizedToolInput[]
  | { [key: string]: NormalizedToolInput };

export const normalizeToolInput = <Input>(
  toolName: string,
  input: Input
): NormalizedToolInput => {
  const visit = (
    value: NormalizedToolInput,
    key?: string
  ): NormalizedToolInput => {
    if (isString(value)) {
      if (key && isVolatileKey(key, TIMESTAMP_KEYS)) {
        return "<timestamp>";
      }

      if (key && isVolatileKey(key, REQUEST_ID_KEYS)) {
        return "<request-id>";
      }

      const normalized = normalizeString(value);

      return toolName === "bash" && key === "command"
        ? normalizeShellWhitespace(normalized)
        : normalized;
    }

    if (Array.isArray(value)) {
      return value.map((item) => visit(item));
    }

    if (isRecordOf(value)) {
      return Object.fromEntries(
        Object.keys(value)
          .toSorted()
          .map((childKey) => [childKey, visit(value[childKey], childKey)])
      );
    }

    return value;
  };

  // SAFETY: Pi tool inputs are JSON-decoded tool arguments, so the root value is already NormalizedToolInput-shaped.
  return visit(input as Input & NormalizedToolInput);
};

export const normalizedToolSignature = <Input>(
  toolName: string,
  input: Input
) => `${toolName}:${JSON.stringify(normalizeToolInput(toolName, input))}`;
