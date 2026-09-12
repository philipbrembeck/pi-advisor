import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  advisorRedactSecretsRef,
  advisorToolPoliciesRef,
  advisorToolResultMaxBytesRef,
  advisorToolResultMaxLinesRef,
} from "./config/state.ts";
import type { AdvisorToolPolicies } from "./config/types.ts";
import { contentParts, isRecord, type RecordValue } from "./content-utils.ts";
import { redactSecrets } from "./redaction.ts";
import { capToolResult } from "./tool-result-cap.ts";

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

const omissionMarker = (omitted: number) =>
  `[Older context omitted: ${omitted} complete entr${omitted === 1 ? "y" : "ies"}]`;

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
    const candidateLength =
      selectedLength +
      entry.length +
      (selected.length > 0 ? separator.length : 0);
    if (
      omissionMarker(omitted).length + separator.length + candidateLength >
      maxChars
    ) {
      break;
    }
    selected.unshift(entry);
    selectedLength = candidateLength;
  }
  const omitted = entries.length - Math.max(1, selected.length);
  const marker = omissionMarker(omitted);
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
