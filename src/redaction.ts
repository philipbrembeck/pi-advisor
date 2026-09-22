import { capUtf8Bytes, isString } from "./content-utils.ts";

const REDACTION_MARKER = "[REDACTED SECRET]";
const PEM_BEGIN_PATTERN = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/giu;
const PEM_END_PATTERN = /-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/iu;
const SECRET_PATTERNS = [
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/giu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu,
  /\b(?:api[_-]?key|token|secret|password|passwd)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s"'&,;)}\]]+)/giu,
  /(?<scheme>[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  /\b(?:aws_secret_access_key|aws_session_token)\s*[:=]\s*[^\s"'&,;)}\]]+/giu,
] as const;

const redactUnterminatedPem = (value: string): string => {
  const begins = [...value.matchAll(PEM_BEGIN_PATTERN)];
  const lastBegin = begins.at(-1);
  if (lastBegin?.index === undefined) {
    return value;
  }
  const hasEnd = PEM_END_PATTERN.test(
    value.slice(lastBegin.index + lastBegin[0].length)
  );
  return hasEnd
    ? value
    : `${value.slice(0, lastBegin.index)}${REDACTION_MARKER}`;
};

/** Redacts common credential forms locally; it is not a data-classification system. */
export const redactSecrets = (value: string): string => {
  let redacted = redactUnterminatedPem(value);
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
