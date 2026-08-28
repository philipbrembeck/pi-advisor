import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type AdvisorToolPolicies,
  advisorRedactSecretsRef,
  advisorToolPoliciesRef,
  advisorToolResultMaxBytesRef,
  advisorToolResultMaxLinesRef,
} from "./config.js";
import { conversationEntry, textFrom } from "./conversation.js";

export const SCOUT_MANIFEST_MAX_BYTES = 64 * 1024;
export const SCOUT_MANIFEST_MAX_GROUPS = 64;
export const SCOUT_GROUP_MAX_BYTES = 24 * 1024;
export const SCOUT_LABEL_MAX_CHARS = 160;
export const SCOUT_SELECTION_MAX_IDS = 32;
export const SCOUT_SYNTHESIS_MAX_BYTES = 4 * 1024;

interface RecordValue {
  [key: string]: unknown;
}

export type ScoutGroupKind =
  | "compaction"
  | "user"
  | "assistant"
  | "tool-exchange"
  | "pending-invocation";

export interface ScoutContextGroup {
  bytes: number;
  content: string;
  id: string;
  kind: ScoutGroupKind;
  label: string;
  originalIndex: number;
  required: boolean;
}

export interface ScoutManifest {
  availableBytes: number;
  availableCount: number;
  groups: ScoutContextGroup[];
  omittedBytes: number;
  omittedCount: number;
}

export type ScoutManifestResult =
  | { ok: true; manifest: ScoutManifest }
  | {
      ok: false;
      reason: "invalid-protocol" | "required-group-overflow";
      message: string;
    };

const isRecord = (value: unknown): value is RecordValue =>
  Boolean(value) && typeof value === "object";
const byteLength = (value: string) => Buffer.byteLength(value, "utf8");
const SPEAKER_PREFIX = /^(User|Executor):\s*/;
const contentParts = (content: unknown): unknown[] =>
  Array.isArray(content) ? content : [];
const toolCalls = (message: RecordValue) =>
  contentParts(message.content).filter(
    (part): part is RecordValue => isRecord(part) && part.type === "toolCall"
  );
const toolCallId = (part: RecordValue) =>
  typeof part.id === "string" ? part.id : undefined;

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

const groupWireBytes = (group: ScoutContextGroup) =>
  byteLength(
    JSON.stringify({
      bytes: group.bytes,
      content: group.content,
      id: group.id,
      kind: group.kind,
      label: group.label,
      required: group.required,
    })
  );

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

export interface BuildScoutManifestOptions {
  currentInvocationId?: string;
  /** @deprecated Use maxManifestBytes for the Scout transport budget. */
  maxBytes?: number;
  /** Maximum reconstructed Advisor conversation characters. */
  maxConversationChars?: number;
  maxGroupBytes?: number;
  maxGroups?: number;
  /** Maximum serialized group-manifest bytes sent to Scout. */
  maxManifestBytes?: number;
  policies?: AdvisorToolPolicies;
  redact?: boolean;
  toolResultMaxBytes?: number;
  toolResultMaxLines?: number;
}

/** Builds disclosed, indivisible history groups from Pi's compaction-aware branch. */
export const buildScoutManifest = (
  ctx: ExtensionContext,
  options: BuildScoutManifestOptions = {}
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: protocol validation keeps fail-open branches visible in one deterministic pass.
): ScoutManifestResult => {
  const entries = ctx.sessionManager.buildContextEntries();
  const policies = options.policies ?? advisorToolPoliciesRef;
  const redact = options.redact ?? advisorRedactSecretsRef;
  const toolResultMaxLines =
    options.toolResultMaxLines ?? advisorToolResultMaxLinesRef;
  const toolResultMaxBytes =
    options.toolResultMaxBytes ?? advisorToolResultMaxBytesRef;
  const {
    maxBytes,
    maxConversationChars,
    maxGroupBytes = SCOUT_GROUP_MAX_BYTES,
    maxGroups = SCOUT_MANIFEST_MAX_GROUPS,
    maxManifestBytes = maxBytes ?? SCOUT_MANIFEST_MAX_BYTES,
  } = options;

  let latestUserIndex = -1;
  const callOwners = new Map<string, { index: number; name: string }>();
  const resultsByCall = new Map<
    string,
    Array<{ entry: RecordValue; index: number }>
  >();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as unknown as RecordValue;
    if (entry.type !== "message" || !isRecord(entry.message)) {
      continue;
    }
    if (entry.message.role === "user" && textFrom(entry.message.content)) {
      latestUserIndex = index;
    }
    if (entry.message.role === "assistant") {
      for (const call of toolCalls(entry.message)) {
        const id = toolCallId(call);
        if (!id || callOwners.has(id)) {
          return {
            message: `Assistant tool calls at context entry ${index} have missing or duplicate IDs.`,
            ok: false,
            reason: "invalid-protocol",
          };
        }
        callOwners.set(id, {
          index,
          name: typeof call.name === "string" ? call.name : "unknown",
        });
      }
    } else if (entry.message.role === "toolResult") {
      const id = entry.message.toolCallId;
      if (typeof id !== "string") {
        return {
          message: `Tool result at context entry ${index} has no tool-call ID.`,
          ok: false,
          reason: "invalid-protocol",
        };
      }
      const results = resultsByCall.get(id) ?? [];
      results.push({ entry, index });
      resultsByCall.set(id, results);
    }
  }
  for (const [id, results] of resultsByCall) {
    if (results.length > 1) {
      return {
        message: `Tool call ${id} has duplicate result messages.`,
        ok: false,
        reason: "invalid-protocol",
      };
    }
  }

  const groups: ScoutContextGroup[] = [];
  const consumedResultIndexes = new Set<number>();
  let protocolOmittedBytes = 0;
  let protocolOmittedCount = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as unknown as RecordValue;
    const disclosed = conversationEntry(
      entry,
      toolResultMaxLines,
      toolResultMaxBytes,
      policies,
      redact
    );
    if (!disclosed) {
      continue;
    }
    const entryId = typeof entry.id === "string" ? entry.id : String(index);
    if (entry.type !== "message" || !isRecord(entry.message)) {
      groups.push(
        createGroup(index, [entryId], "compaction", disclosed, false)
      );
      continue;
    }
    const { message } = entry;
    if (message.role === "user") {
      groups.push(
        createGroup(
          index,
          [entryId],
          "user",
          disclosed,
          index === latestUserIndex
        )
      );
      continue;
    }
    if (message.role === "toolResult") {
      if (consumedResultIndexes.has(index)) {
        continue;
      }
      const resultId = message.toolCallId;
      const owner =
        typeof resultId === "string" ? callOwners.get(resultId) : undefined;
      if (owner) {
        return {
          message: `Tool result at context entry ${index} precedes or conflicts with its retained call.`,
          ok: false,
          reason: "invalid-protocol",
        };
      }
      // Compaction or interrupted history can retain a result without its call.
      // It is unavailable optional evidence and is never offered to Scout.
      protocolOmittedCount += 1;
      protocolOmittedBytes += byteLength(disclosed);
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }

    const calls = toolCalls(message);
    if (calls.length === 0) {
      groups.push(createGroup(index, [entryId], "assistant", disclosed, false));
      continue;
    }
    const callIds = calls.map(toolCallId) as string[];
    const immediate = entries[index + 1] as unknown as RecordValue | undefined;
    if (
      immediate?.type === "message" &&
      isRecord(immediate.message) &&
      immediate.message.role === "toolResult" &&
      typeof immediate.message.toolCallId === "string" &&
      !callIds.includes(immediate.message.toolCallId) &&
      !callOwners.has(immediate.message.toolCallId)
    ) {
      return {
        message: `Tool result at context entry ${index + 1} does not match its adjacent assistant group.`,
        ok: false,
        reason: "invalid-protocol",
      };
    }
    const missing = new Set<string>();
    const resultParts: string[] = [];
    const resultEntryIds: string[] = [];
    for (const [callIndex, callId] of callIds.entries()) {
      const resultMatch = resultsByCall.get(callId)?.[0];
      if (!resultMatch) {
        missing.add(callId);
        continue;
      }
      if (resultMatch.index <= index) {
        return {
          message: `Tool result at context entry ${resultMatch.index} precedes its assistant call.`,
          ok: false,
          reason: "invalid-protocol",
        };
      }
      const resultMessage = resultMatch.entry.message;
      const expectedName =
        typeof calls[callIndex].name === "string"
          ? calls[callIndex].name
          : "unknown";
      if (!isRecord(resultMessage) || resultMessage.toolName !== expectedName) {
        return {
          message: `Tool result at context entry ${resultMatch.index} conflicts with call ${callId}.`,
          ok: false,
          reason: "invalid-protocol",
        };
      }
      consumedResultIndexes.add(resultMatch.index);
      const resultText = conversationEntry(
        resultMatch.entry,
        toolResultMaxLines,
        toolResultMaxBytes,
        policies,
        redact
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
    if (missing.size > 0) {
      const { currentInvocationId } = options;
      const pendingCurrentInvocation =
        currentInvocationId !== undefined &&
        missing.size === 1 &&
        missing.has(currentInvocationId) &&
        callIds.includes(currentInvocationId);
      if (!pendingCurrentInvocation) {
        protocolOmittedCount += 1;
        protocolOmittedBytes += byteLength(
          [disclosed, ...resultParts].join("\n\n")
        );
        continue;
      }
      const pendingDisclosed = pendingInvocationDisclosure(
        entry,
        currentInvocationId,
        toolResultMaxLines,
        toolResultMaxBytes,
        policies,
        redact,
        disclosed
      );
      groups.push(
        createGroup(
          index,
          [entryId, ...resultEntryIds],
          "pending-invocation",
          [pendingDisclosed ?? disclosed, ...resultParts].join("\n\n"),
          true
        )
      );
      continue;
    }
    groups.push(
      createGroup(
        index,
        [entryId, ...resultEntryIds],
        "tool-exchange",
        [disclosed, ...resultParts].join("\n\n"),
        false
      )
    );
  }

  const availableCount = groups.length + protocolOmittedCount;
  const availableBytes =
    groups.reduce((sum, group) => sum + groupWireBytes(group), 0) +
    protocolOmittedBytes;
  if (maxManifestBytes <= 0) {
    return {
      manifest: {
        availableBytes: 0,
        availableCount: 0,
        groups: [],
        omittedBytes: 0,
        omittedCount: 0,
      },
      ok: true,
    };
  }
  const required = groups.filter((group) => group.required);
  if (
    required.some((group) => group.bytes > maxGroupBytes) ||
    required.length > maxGroups ||
    required.reduce((sum, group) => sum + groupWireBytes(group), 0) >
      maxManifestBytes
  ) {
    return {
      message:
        "Required Scout context exceeds the Scout manifest transport limit.",
      ok: false,
      reason: "required-group-overflow",
    };
  }
  const contentChars = (items: ScoutContextGroup[]) =>
    items.reduce((sum, group) => sum + group.content.length, 0) +
    Math.max(0, items.length - 1) * 2;
  if (
    maxConversationChars !== undefined &&
    contentChars(required) > maxConversationChars
  ) {
    return {
      message:
        "Required Scout context exceeds the Advisor conversation budget.",
      ok: false,
      reason: "required-group-overflow",
    };
  }
  const selected = groups.filter(
    (group) => group.required || group.bytes <= maxGroupBytes
  );
  const fits = () =>
    selected.length <= maxGroups &&
    selected.reduce((sum, group) => sum + groupWireBytes(group), 0) <=
      maxManifestBytes &&
    (maxConversationChars === undefined ||
      contentChars(selected) <= maxConversationChars);
  while (!fits()) {
    const optionalIndex = selected.findIndex((group) => !group.required);
    if (optionalIndex < 0) {
      return {
        message: "Required Scout context exceeds fixed manifest limits.",
        ok: false,
        reason: "required-group-overflow",
      };
    }
    selected.splice(optionalIndex, 1);
  }
  const selectedIds = new Set(selected.map((group) => group.id));
  const omitted = groups.filter((group) => !selectedIds.has(group.id));
  return {
    manifest: {
      availableBytes,
      availableCount,
      groups: selected,
      omittedBytes:
        protocolOmittedBytes +
        omitted.reduce((sum, group) => sum + group.bytes, 0),
      omittedCount: protocolOmittedCount + omitted.length,
    },
    ok: true,
  };
};

const prefixWithinCharBudget = (value: string, maxChars: number) => {
  let result = "";
  for (const character of value) {
    if (result.length + character.length > maxChars) {
      break;
    }
    result += character;
  }
  return result;
};

export const reconstructScoutConversation = (
  manifest: ScoutManifest,
  selectedIds: string[],
  synthesis?: string,
  maxChars = Number.MAX_SAFE_INTEGER
): string => {
  const selected = new Set(selectedIds);
  const evidence = manifest.groups
    .filter((group) => group.required || selected.has(group.id))
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map((group) => group.content);
  const evidenceText = evidence.join("\n\n");
  if (maxChars <= 0) {
    return "";
  }
  if (evidenceText.length >= maxChars) {
    return prefixWithinCharBudget(evidenceText, maxChars);
  }
  const inference = synthesis?.trim()
    ? `[Scout synthesis — untrusted, non-authoritative inference; not evidence]\n${synthesis.trim()}`
    : undefined;
  if (!inference) {
    return evidenceText;
  }
  const separator = evidenceText ? "\n\n" : "";
  const remaining = maxChars - evidenceText.length - separator.length;
  if (remaining <= 0) {
    return evidenceText;
  }
  return `${evidenceText}${separator}${prefixWithinCharBudget(inference, remaining)}`;
};
