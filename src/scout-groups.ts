import { createHash } from "node:crypto";
import type { AdvisorToolPolicies } from "./config/types.ts";
import {
  byteLength,
  contentParts,
  isRecord,
  type RecordValue,
} from "./content-utils.ts";
import { conversationEntry } from "./conversation.ts";
import { invalid, toolCallId, toolCalls } from "./scout-protocol.ts";
import {
  type InvalidProtocolResult,
  SCOUT_LABEL_MAX_CHARS,
  type ScoutContextGroup,
  type ScoutGroupKind,
} from "./scout-types.ts";

export interface GroupPass {
  groups: ScoutContextGroup[];
  ok: true;
  protocolOmittedBytes: number;
  protocolOmittedCount: number;
}

const SPEAKER_PREFIX = /^(User|Executor):\s*/;

const boundedLabel = (value: string) =>
  [...value.replace(/\s+/g, " ").trim()]
    .slice(0, SCOUT_LABEL_MAX_CHARS)
    .join("");

const labelFor = (kind: ScoutGroupKind, content: string) => {
  const preview = boundedLabel(content.replace(SPEAKER_PREFIX, ""));
  const prefix: Record<ScoutGroupKind, string> = {
    assistant: "Executor",
    compaction: "Compaction summary",
    "pending-invocation": "Current Advisor invocation",
    "tool-exchange": "Tool exchange",
    user: "User request",
  };
  return boundedLabel(`${prefix[kind]}: ${preview || "(no text)"}`);
};

const stableId = (
  index: number,
  entryIds: string[],
  kind: ScoutGroupKind,
  content: string
) =>
  `g_${createHash("sha256")
    .update(JSON.stringify([index, entryIds, kind, content]))
    .digest("hex")
    .slice(0, 16)}`;

/** The wire projection shared by manifest transport and size accounting. */
export const groupWire = (group: ScoutContextGroup) => ({
  bytes: group.bytes,
  content: group.content,
  id: group.id,
  kind: group.kind,
  label: group.label,
  required: group.required,
});

export const groupWireBytes = (group: ScoutContextGroup) =>
  byteLength(JSON.stringify(groupWire(group)));

const createGroup = (
  originalIndex: number,
  entryIds: string[],
  kind: ScoutGroupKind,
  content: string,
  required: boolean
): ScoutContextGroup => ({
  bytes: byteLength(content),
  content,
  id: stableId(originalIndex, entryIds, kind, content),
  kind,
  label: labelFor(kind, content),
  originalIndex,
  required,
});

const pendingAdvisorArguments = (value: unknown): RecordValue => {
  if (!isRecord(value)) {
    return {};
  }
  const allowed: RecordValue = {};
  for (const key of ["gitContext", "question"]) {
    if (key in value) {
      allowed[key] = value[key];
    }
  }
  return allowed;
};

const pendingInvocationDisclosure = (
  entry: RecordValue,
  invocationId: string,
  toolResultMaxLines: number,
  toolResultMaxBytes: number,
  policies: AdvisorToolPolicies,
  redact: boolean,
  disclosed: string
) => {
  if (!isRecord(entry.message)) {
    return disclosed;
  }
  const content = contentParts(entry.message.content).map((part) => {
    if (
      !isRecord(part) ||
      part.type !== "toolCall" ||
      toolCallId(part) !== invocationId ||
      part.name !== "ask_advisor"
    ) {
      return part;
    }
    return { ...part, arguments: pendingAdvisorArguments(part.arguments) };
  });
  return conversationEntry(
    { ...entry, message: { ...entry.message, content } },
    toolResultMaxLines,
    toolResultMaxBytes,
    policies,
    redact
  );
};

export interface DisclosureCaps {
  currentInvocationId?: string;
  policies: AdvisorToolPolicies;
  redact: boolean;
  toolResultMaxBytes: number;
  toolResultMaxLines: number;
}

type ToolExchangeOutcome =
  | { kind: "group"; group: ScoutContextGroup }
  | { kind: "omitted"; bytes: number }
  | { kind: "invalid"; message: string };

/** Groups an assistant message with its tool calls and matched results into
 * one indivisible tool-exchange (or pending-invocation) group. */
const toolExchangeGroup = (
  entry: RecordValue,
  index: number,
  entryId: string,
  disclosed: string,
  immediate: unknown,
  indexed: {
    callOwners: Map<string, { index: number; name: string }>;
    resultsByCall: Map<string, Array<{ entry: RecordValue; index: number }>>;
  },
  consumedResultIndexes: Set<number>,
  caps: DisclosureCaps
): ToolExchangeOutcome => {
  const calls = toolCalls(entry.message as RecordValue);
  const callIds = calls.map(toolCallId) as string[];
  const adjacentFailure = adjacentResultMismatch(
    immediate,
    index,
    callIds,
    indexed.callOwners
  );
  if (adjacentFailure) {
    return { kind: "invalid", message: adjacentFailure };
  }
  const missing = new Set<string>();
  const resultParts: string[] = [];
  const resultEntryIds: string[] = [];
  const matchFailure = collectResults(
    calls,
    callIds,
    index,
    indexed.resultsByCall,
    consumedResultIndexes,
    caps,
    missing,
    resultParts,
    resultEntryIds
  );
  if (matchFailure) {
    return { kind: "invalid", message: matchFailure };
  }
  if (missing.size > 0) {
    return missingOutcome(
      entry,
      index,
      entryId,
      disclosed,
      callIds,
      missing,
      resultParts,
      resultEntryIds,
      caps
    );
  }
  return {
    group: createGroup(
      index,
      [entryId, ...resultEntryIds],
      "tool-exchange",
      [disclosed, ...resultParts].join("\n\n"),
      false
    ),
    kind: "group",
  };
};

const adjacentResultMismatch = (
  immediate: unknown,
  index: number,
  callIds: string[],
  callOwners: Map<string, { index: number; name: string }>
): string | undefined => {
  const next = immediate as RecordValue | undefined;
  if (
    next?.type === "message" &&
    isRecord(next.message) &&
    next.message.role === "toolResult" &&
    typeof next.message.toolCallId === "string" &&
    !callIds.includes(next.message.toolCallId) &&
    !callOwners.has(next.message.toolCallId)
  ) {
    return `Tool result at context entry ${index + 1} does not match its adjacent assistant group.`;
  }
  return undefined;
};

const collectResults = (
  calls: RecordValue[],
  callIds: string[],
  index: number,
  resultsByCall: Map<string, Array<{ entry: RecordValue; index: number }>>,
  consumedResultIndexes: Set<number>,
  caps: DisclosureCaps,
  missing: Set<string>,
  resultParts: string[],
  resultEntryIds: string[]
): string | undefined => {
  for (const [callIndex, callId] of callIds.entries()) {
    const resultMatch = resultsByCall.get(callId)?.[0];
    if (!resultMatch) {
      missing.add(callId);
      continue;
    }
    if (resultMatch.index <= index) {
      return `Tool result at context entry ${resultMatch.index} precedes its assistant call.`;
    }
    const resultMessage = resultMatch.entry.message;
    const expectedName =
      typeof calls[callIndex].name === "string"
        ? calls[callIndex].name
        : "unknown";
    if (!isRecord(resultMessage) || resultMessage.toolName !== expectedName) {
      return `Tool result at context entry ${resultMatch.index} conflicts with call ${callId}.`;
    }
    consumedResultIndexes.add(resultMatch.index);
    const resultText = conversationEntry(
      resultMatch.entry,
      caps.toolResultMaxLines,
      caps.toolResultMaxBytes,
      caps.policies,
      caps.redact
    );
    if (resultText) {
      resultParts.push(resultText);
    }
    resultEntryIds.push(
      typeof resultMatch.entry.id === "string"
        ? resultMatch.entry.id
        : String(resultMatch.index)
    );
  }
  return undefined;
};

const missingOutcome = (
  entry: RecordValue,
  index: number,
  entryId: string,
  disclosed: string,
  callIds: string[],
  missing: Set<string>,
  resultParts: string[],
  resultEntryIds: string[],
  caps: DisclosureCaps
): ToolExchangeOutcome => {
  const { currentInvocationId } = caps;
  const pendingCurrentInvocation =
    currentInvocationId !== undefined &&
    missing.size === 1 &&
    missing.has(currentInvocationId) &&
    callIds.includes(currentInvocationId);
  if (!pendingCurrentInvocation) {
    return {
      bytes: byteLength([disclosed, ...resultParts].join("\n\n")),
      kind: "omitted",
    };
  }
  const pendingDisclosed = pendingInvocationDisclosure(
    entry,
    currentInvocationId,
    caps.toolResultMaxLines,
    caps.toolResultMaxBytes,
    caps.policies,
    caps.redact,
    disclosed
  );
  return {
    group: createGroup(
      index,
      [entryId, ...resultEntryIds],
      "pending-invocation",
      [pendingDisclosed ?? disclosed, ...resultParts].join("\n\n"),
      true
    ),
    kind: "group",
  };
};

/** Second entry pass: groups each disclosed entry, delegating
 * assistant-with-calls entries to the tool-exchange builder. */
export const buildGroups = (
  entries: unknown[],
  indexed: {
    callOwners: Map<string, { index: number; name: string }>;
    latestUserIndex: number;
    resultsByCall: Map<string, Array<{ entry: RecordValue; index: number }>>;
  },
  caps: DisclosureCaps & {
    maxGroupBytes: number;
  }
): GroupPass | InvalidProtocolResult => {
  const groups: ScoutContextGroup[] = [];
  const consumedResultIndexes = new Set<number>();
  let protocolOmittedBytes = 0;
  let protocolOmittedCount = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as unknown as RecordValue;
    const disclosed = conversationEntry(
      entry,
      caps.toolResultMaxLines,
      caps.toolResultMaxBytes,
      caps.policies,
      caps.redact
    );
    if (!disclosed) {
      continue;
    }
    const outcome = groupForEntry(
      entry,
      index,
      disclosed,
      entries[index + 1],
      indexed,
      consumedResultIndexes,
      caps
    );
    if (outcome.kind === "invalid") {
      return invalid(outcome.message);
    }
    if (outcome.kind === "omitted") {
      protocolOmittedCount += 1;
      protocolOmittedBytes += outcome.bytes;
    } else if (outcome.kind === "group") {
      groups.push(outcome.group);
    }
  }
  return {
    groups,
    ok: true,
    protocolOmittedBytes,
    protocolOmittedCount,
  };
};

type EntryOutcome =
  | { kind: "group"; group: ScoutContextGroup }
  | { kind: "omitted"; bytes: number }
  | { kind: "invalid"; message: string }
  | { kind: "skipped" };

const groupForEntry = (
  entry: RecordValue,
  index: number,
  disclosed: string,
  immediate: unknown,
  indexed: {
    callOwners: Map<string, { index: number; name: string }>;
    latestUserIndex: number;
    resultsByCall: Map<string, Array<{ entry: RecordValue; index: number }>>;
  },
  consumedResultIndexes: Set<number>,
  caps: DisclosureCaps
): EntryOutcome => {
  const entryId = typeof entry.id === "string" ? entry.id : String(index);
  if (entry.type !== "message" || !isRecord(entry.message)) {
    return {
      group: createGroup(index, [entryId], "compaction", disclosed, false),
      kind: "group",
    };
  }
  const { message } = entry;
  if (message.role === "user") {
    return {
      group: createGroup(
        index,
        [entryId],
        "user",
        disclosed,
        index === indexed.latestUserIndex
      ),
      kind: "group",
    };
  }
  if (message.role === "toolResult") {
    return toolResultOutcome(
      message,
      index,
      disclosed,
      indexed.callOwners,
      consumedResultIndexes
    );
  }
  if (message.role !== "assistant") {
    return { kind: "skipped" };
  }
  if (!hasCalls(message)) {
    return {
      group: createGroup(index, [entryId], "assistant", disclosed, false),
      kind: "group",
    };
  }
  return toolExchangeGroup(
    entry,
    index,
    entryId,
    disclosed,
    immediate,
    indexed,
    consumedResultIndexes,
    caps
  );
};

const toolResultOutcome = (
  message: RecordValue,
  index: number,
  disclosed: string,
  callOwners: Map<string, { index: number; name: string }>,
  consumedResultIndexes: Set<number>
): EntryOutcome => {
  if (consumedResultIndexes.has(index)) {
    return { kind: "skipped" };
  }
  if (ownerOf(message, callOwners)) {
    return {
      kind: "invalid",
      message: `Tool result at context entry ${index} precedes or conflicts with its retained call.`,
    };
  }
  // Retained results without their call are unavailable optional evidence
  // and are never offered to Scout.
  return { bytes: byteLength(disclosed), kind: "omitted" };
};

const ownerOf = (
  message: RecordValue,
  callOwners: Map<string, { index: number; name: string }>
) =>
  typeof message.toolCallId === "string"
    ? callOwners.get(message.toolCallId)
    : undefined;

const hasCalls = (message: RecordValue) =>
  contentPartsOf(message).some(
    (part) => isRecord(part) && part.type === "toolCall"
  );

const contentPartsOf = (message: RecordValue) =>
  Array.isArray(message.content) ? message.content : [];

/** Final pass: selects groups within the transport and conversation budgets,
 * keeping every required group. */
