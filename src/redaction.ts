import { capUtf8Bytes, isString } from "./content-utils.ts";

const REDACTION_MARKER = "[REDACTED SECRET]";
const MAX_REDACTION_CHARS = 65_536;
const OVERSIZED_MARKER = "[Redaction omitted: input exceeds 65536 characters]";

const PEM_MARKER_PATTERN =
  /-----(?<action>BEGIN|END)(?: (?<type>[A-Z0-9]+))? PRIVATE KEY-----/giu;

const CREDENTIAL_NAME = String.raw`(?:api[_-]?key|token|secret|password|passwd)`;
const ASSIGNMENT_START = String.raw`(?:(?:"(?:[a-z0-9]+[_-])*?${CREDENTIAL_NAME}"|'(?:[a-z0-9]+[_-])*?${CREDENTIAL_NAME}')|(?:\b|_)${CREDENTIAL_NAME})[ \t]*[:=][ \t]*`;

const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`${ASSIGNMENT_START}(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[^\r\n]|[^"\\\r\n]|\\(?=\r?\n|\r|$))*(?=\r?\n|\r|$)|'(?:\\[^\r\n]|[^'\\\r\n]|\\(?=\r?\n|\r|$))*(?=\r?\n|\r|$)|[^\s"'&,;)}\]]+)`,
  "giu"
);

const ASSIGNMENT_START_PATTERN = new RegExp(ASSIGNMENT_START, "giu");

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu;

const SECRET_PATTERNS = [
  /(?<scheme>(?<![a-z0-9+.-])[a-z0-9+.-]+:\/\/)[^\s/@:]+:[^\s/@]+@/giu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  /\b(?:aws_secret_access_key|aws_session_token)\s*[:=]\s*[^\s"'&,;)}\]]+/giu,
] as const;

const redactPem = (value: string): string => {
  const parts: string[] = [];
  const stack: string[] = [];
  let copied = 0;

  for (const match of value.matchAll(PEM_MARKER_PATTERN)) {
    const type = (match.groups?.type ?? "").toUpperCase();

    if (match.groups?.action.toUpperCase() === "BEGIN") {
      if (stack.length === 0) {
        parts.push(value.slice(copied, match.index));
      }

      stack.push(type);
    } else if (stack.length > 0) {
      if (stack.pop() !== type) {
        return `${parts.join("")}${REDACTION_MARKER}`;
      }

      if (stack.length === 0) {
        parts.push(REDACTION_MARKER);
        copied = match.index + match[0].length;
      }
    }
  }

  return stack.length > 0
    ? `${parts.join("")}${REDACTION_MARKER}`
    : `${parts.join("")}${value.slice(copied)}`;
};

const redactAssignments = (value: string): string => {
  const parts: string[] = [];
  let copied = 0;

  for (const match of value.matchAll(SECRET_ASSIGNMENT_PATTERN)) {
    parts.push(value.slice(copied, match.index), REDACTION_MARKER);

    const starts = match[0].matchAll(ASSIGNMENT_START_PATTERN);
    starts.next();

    if (!starts.next().done) {
      return parts.join("");
    }

    copied = match.index + match[0].length;
  }

  return `${parts.join("")}${value.slice(copied)}`;
};

/** Redacts common credential forms locally; it is not a data-classification system. */
export const redactSecrets = (value: string): string => {
  if (value.length > MAX_REDACTION_CHARS) {
    return OVERSIZED_MARKER;
  }

  let redacted = redactPem(value).replaceAll(BEARER_PATTERN, REDACTION_MARKER);
  redacted = redactAssignments(redacted);

  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (_match, scheme) =>
      isString(scheme) ? `${scheme}${REDACTION_MARKER}@` : REDACTION_MARKER
    );
  }

  return redacted;
};

/** Redacts before a byte-safe cap so no secret fragment survives truncation. */
export const redactAndCapText = (
  value: string,
  maxBytes: number,
  redact = true
): string => {
  const source = redact ? redactSecrets(value) : value;

  return capUtf8Bytes(source, maxBytes);
};
