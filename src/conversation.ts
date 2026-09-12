import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  advisorRedactSecretsRef,
  advisorToolPoliciesRef,
  advisorToolResultMaxBytesRef,
  advisorToolResultMaxLinesRef,
} from "./config/state.ts";
import type { AdvisorToolPolicies } from "./config/types.ts";
import {
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES,
} from "./config/types.ts";

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  Boolean(value) && typeof value === "object";

const contentParts = (content: unknown): unknown[] => {
  if (typeof content === "string") {
    return [content];
  }
  return Array.isArray(content) ? content : [];
};

const textFromPart = (part: unknown): string => {
  if (typeof part === "string") {
    return part;
  }
  if (!isRecord(part) || part.type !== "text") {
    return "";
  }
  return typeof part.text === "string" ? part.text : "";
};

export const textFrom = (content: unknown): string =>
  contentParts(content).map(textFromPart).join("\n").trim();

const byteLength = (value: string) => Buffer.byteLength(value, "utf8");

const REDACTION_MARKER = "[REDACTED SECRET]";
const PEM_BEGIN_PATTERN = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/gi;
const PEM_END_PATTERN = /-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/i;
const SECRET_PATTERNS = [
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:api[_-]?key|token|secret|password|passwd)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s"'&,;)}\]]+)/gi,
  /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(?:aws_secret_access_key|aws_session_token)\s*[:=]\s*[^\s"'&,;)}\]]+/gi,
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
      typeof scheme === "string"
        ? `${scheme}${REDACTION_MARKER}@`
        : REDACTION_MARKER
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
  let result = "";
  for (const character of source) {
    if (byteLength(result + character) > maxBytes) {
      break;
    }
    result += character;
  }
  return result;
};

export interface ToolResultTruncation {
  content: string;
  omittedLines: number;
  totalBytes: number;
  totalLines: number;
  truncated: boolean;
}

export const capToolResult = (
  value: string,
  maxLines = DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES,
  maxBytes = DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES
): ToolResultTruncation => {
  const lines = value.split("\n");
  const totalLines = lines.length;
  const totalBytes = byteLength(value);
  if ((maxLines === 0 || maxBytes === 0) && value.length > 0) {
    return {
      content: "[Tool result omitted: configured limit is zero]",
      omittedLines: totalLines,
      totalBytes,
      totalLines,
      truncated: true,
    };
  }
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content: value,
      omittedLines: 0,
      totalBytes,
      totalLines,
      truncated: false,
    };
  }

  const marker = "[... omitted tool-result section ...]";
  const markerBytes = byteLength(marker);
  if (maxBytes < markerBytes || maxLines === 1) {
    const content = [...marker].reduce(
      (result, character) =>
        byteLength(result + character) <= maxBytes
          ? result + character
          : result,
      ""
    );
    return {
      content,
      omittedLines: totalLines,
      totalBytes,
      totalLines,
      truncated: true,
    };
  }
  const headCount = Math.floor((maxLines - 1) / 2);
  const tailCount = maxLines - 1 - headCount;
  const collect = (
    candidates: string[],
    maxEntries: number,
    maxContentBytes: number
  ) => {
    const selected: string[] = [];
    let used = 0;
    for (const line of candidates.slice(0, maxEntries)) {
      const next = used + byteLength(line) + (selected.length ? 1 : 0);
      if (next > maxContentBytes) {
        break;
      }
      selected.push(line);
      used = next;
    }
    return selected;
  };
  const availableBytes = maxBytes - markerBytes - 2;
  const head = collect(lines, headCount, Math.floor(availableBytes / 2));
  const tail = collect(
    lines.slice(Math.max(head.length, lines.length - tailCount)),
    tailCount,
    availableBytes - byteLength(head.join("\n"))
  );
  const content = [...head, marker, ...tail].join("\n");
  return {
    content,
    omittedLines: Math.max(0, totalLines - head.length - tail.length),
    totalBytes,
    totalLines,
    truncated: true,
  };
};

const assistantEntry = (
  message: RecordValue,
  policies: AdvisorToolPolicies,
  redact: boolean
): string | undefined => {
  const parts: string[] = [];
  const text = textFrom(message.content);
  if (text) {
    parts.push(redact ? redactSecrets(text) : text);
  }
  for (const part of contentParts(message.content)) {
    if (!isRecord(part) || part.type !== "toolCall") {
      continue;
    }
    const toolName = typeof part.name === "string" ? part.name : "unknown";
    const policy = policies[toolName] ?? "full";
    if (policy === "exclude") {
      parts.push(`[Tool Call: ${toolName}] (excluded by Advisor tool policy)`);
      continue;
    }
    if (policy === "summary") {
      parts.push(
        `[Tool Call: ${toolName}] (arguments omitted by Advisor tool policy: summary)`
      );
      continue;
    }
    const argumentsText = JSON.stringify(part.arguments) ?? "undefined";
    parts.push(
      `[Tool Call: ${toolName}(${redact ? redactSecrets(argumentsText) : argumentsText})]`
    );
  }
  return parts.length > 0 ? `Executor: ${parts.join("\n")}` : undefined;
};

const toolResultEntry = (
  message: RecordValue,
  toolResultMaxLines: number,
  toolResultMaxBytes: number,
  policies: AdvisorToolPolicies,
  redact: boolean
): string => {
  const status = message.isError ? "error" : "success";
  const toolName =
    typeof message.toolName === "string" ? message.toolName : "unknown";
  const policy = policies[toolName] ?? "full";
  const source = textFrom(message.content);
  if (policy === "exclude") {
    return `[Tool Result for ${toolName}] (excluded by Advisor tool policy)`;
  }
  if (policy === "summary") {
    const capped = capToolResult(
      source,
      toolResultMaxLines,
      toolResultMaxBytes
    );
    return `[Tool Result for ${toolName}] (output omitted by Advisor tool policy: summary; status: ${status}; ${capped.totalLines} lines, ${capped.totalBytes} bytes; source output was${capped.truncated ? "" : " not"} truncated)`;
  }
  const disclosed = redact ? redactSecrets(source) : source;
  const capped = capToolResult(
    disclosed,
    toolResultMaxLines,
    toolResultMaxBytes
  );
  return `[Tool Result for ${toolName}] (${message.isError ? "Error " : ""}output):\n${capped.content}`;
};

export const conversationEntry = (
  entry: unknown,
  toolResultMaxLines: number,
  toolResultMaxBytes: number,
  policies: AdvisorToolPolicies,
  redact: boolean
): string | undefined => {
  if (!isRecord(entry)) {
    return;
  }
  if (entry.type === "compaction" && typeof entry.summary === "string") {
    return `[System Compaction Summary]: ${redact ? redactSecrets(entry.summary) : entry.summary}`;
  }
  if (entry.type !== "message" || !isRecord(entry.message)) {
    return;
  }
  const { message } = entry;
  if (message.role === "user") {
    const text = textFrom(message.content);
    return text ? `User: ${redact ? redactSecrets(text) : text}` : undefined;
  }
  if (message.role === "assistant") {
    return assistantEntry(message, policies, redact);
  }
  if (message.role === "toolResult" || message.role === "tool") {
    return toolResultEntry(
      message,
      toolResultMaxLines,
      toolResultMaxBytes,
      policies,
      redact
    );
  }
};

const selectRecentEntries = (entries: string[], maxChars: number): string => {
  const separator = "\n\n";
  const joined = entries.join(separator);
  if (joined.length <= maxChars || maxChars === Number.MAX_SAFE_INTEGER) {
    return joined;
  }
  const newestTruncated = "[Newest entry truncated]";
  if (entries.length === 1) {
    const prefix = `${newestTruncated}${separator}`;
    return `${prefix}${entries[0].slice(0, Math.max(0, maxChars - prefix.length))}`.slice(
      0,
      maxChars
    );
  }
  const selected: string[] = [];
  let selectedLength = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const candidateCount = selected.length + 1;
    const omitted = entries.length - candidateCount;
    const marker = `[Older context omitted: ${omitted} complete entr${omitted === 1 ? "y" : "ies"}]`;
    const candidateLength =
      selectedLength +
      entry.length +
      (selected.length > 0 ? separator.length : 0);
    if (marker.length + separator.length + candidateLength > maxChars) {
      break;
    }
    selected.unshift(entry);
    selectedLength = candidateLength;
  }
  const omitted = entries.length - Math.max(1, selected.length);
  const marker = `[Older context omitted: ${omitted} complete entr${omitted === 1 ? "y" : "ies"}]`;
  if (selected.length > 0) {
    return `${marker}${separator}${selected.join(separator)}`;
  }
  const prefix = `${marker}${separator}${newestTruncated}${separator}`;
  return `${prefix}${entries.at(-1)?.slice(0, Math.max(0, maxChars - prefix.length)) ?? ""}`.slice(
    0,
    maxChars
  );
};

export const recentConversation = (
  ctx: ExtensionContext,
  maxChars = 15_000,
  toolResultMaxLines = advisorToolResultMaxLinesRef,
  toolResultMaxBytes = advisorToolResultMaxBytesRef,
  policies = advisorToolPoliciesRef,
  redact = advisorRedactSecretsRef
): string => {
  if (maxChars === 0) {
    return "";
  }
  const entries = ctx.sessionManager
    .getBranch()
    .map((entry) =>
      conversationEntry(
        entry,
        toolResultMaxLines,
        toolResultMaxBytes,
        policies,
        redact
      )
    )
    .filter((entry): entry is string => entry !== undefined);
  return selectRecentEntries(entries, maxChars);
};
