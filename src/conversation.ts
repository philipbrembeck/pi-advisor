import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type AdvisorToolPolicies,
  advisorRedactSecretsRef,
  advisorToolPoliciesRef,
  advisorToolResultMaxBytesRef,
  advisorToolResultMaxLinesRef,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES,
} from "./config.js";

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
const SECRET_PATTERNS = [
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:api[_-]?key|token|secret|password|passwd)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s"'&,;)}\]]+)/gi,
  /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(?:aws_secret_access_key|aws_session_token)\s*[:=]\s*[^\s"'&,;)}\]]+/gi,
] as const;

/** Redacts common credential forms locally; it is not a data-classification system. */
export const redactSecrets = (value: string): string => {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (_match, scheme) =>
      typeof scheme === "string"
        ? `${scheme}${REDACTION_MARKER}@`
        : REDACTION_MARKER
    );
  }
  return redacted;
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

const conversationEntry = (
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
  const selected: string[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const candidate = [entries[index], ...selected].join(separator);
    if (candidate.length <= maxChars || selected.length === 0) {
      selected.unshift(entries[index]);
    } else {
      break;
    }
  }
  const omitted = entries.length - selected.length;
  const suffix = selected.length
    ? `${separator}${selected.join(separator)}`
    : "";
  return `[Older context omitted: ${omitted} complete entr${omitted === 1 ? "y" : "ies"}]${suffix}`;
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
