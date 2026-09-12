import { contentParts, isRecord, type RecordValue } from "./content-utils.ts";
import { textFrom } from "./conversation.ts";
import type { InvalidProtocolResult } from "./scout-types.ts";

/** The single invalid-protocol failure constructor. */
export const invalid = (message: string): InvalidProtocolResult => ({
  message,
  ok: false,
  reason: "invalid-protocol",
});

export interface ToolCallIndex {
  callOwners: Map<string, { index: number; name: string }>;
  latestUserIndex: number;
  resultsByCall: Map<string, Array<{ entry: RecordValue; index: number }>>;
}

export const toolCalls = (message: RecordValue) =>
  contentParts(message.content).filter(
    (part): part is RecordValue => isRecord(part) && part.type === "toolCall"
  );

export const toolCallId = (part: RecordValue) =>
  typeof part.id === "string" ? part.id : undefined;

/** First entry pass: indexes assistant tool calls and their results, tracking
 * the latest user message. Returns an invalid result on protocol violations. */
export const indexToolCalls = (
  entries: unknown[]
): { index: ToolCallIndex; ok: true } | InvalidProtocolResult => {
  const callOwners = new Map<string, { index: number; name: string }>();
  const resultsByCall = new Map<
    string,
    Array<{ entry: RecordValue; index: number }>
  >();
  const state = { latestUserIndex: -1 };
  for (let index = 0; index < entries.length; index += 1) {
    const failure = indexEntry(
      entries[index] as unknown as RecordValue,
      index,
      callOwners,
      resultsByCall,
      state
    );
    if (failure) {
      return failure;
    }
  }
  for (const [id, results] of resultsByCall) {
    if (results.length > 1) {
      return invalid(`Tool call ${id} has duplicate result messages.`);
    }
  }
  return {
    index: {
      callOwners,
      latestUserIndex: state.latestUserIndex,
      resultsByCall,
    },
    ok: true,
  };
};

const indexEntry = (
  entry: RecordValue,
  index: number,
  callOwners: Map<string, { index: number; name: string }>,
  resultsByCall: Map<string, Array<{ entry: RecordValue; index: number }>>,
  state: { latestUserIndex: number }
): InvalidProtocolResult | undefined => {
  if (entry.type !== "message" || !isRecord(entry.message)) {
    return undefined;
  }
  if (entry.message.role === "user" && textFrom(entry.message.content)) {
    state.latestUserIndex = index;
  }
  if (entry.message.role === "assistant") {
    return indexAssistantCalls(entry.message, index, callOwners);
  }
  if (entry.message.role === "toolResult") {
    return indexToolResult(entry, entry.message, index, resultsByCall);
  }
  return undefined;
};

const indexToolResult = (
  entry: RecordValue,
  message: RecordValue,
  index: number,
  resultsByCall: Map<string, Array<{ entry: RecordValue; index: number }>>
): InvalidProtocolResult | undefined => {
  const id = message.toolCallId;
  if (typeof id !== "string") {
    return invalid(
      `Tool result at context entry ${index} has no tool-call ID.`
    );
  }
  const results = resultsByCall.get(id) ?? [];
  results.push({ entry, index });
  resultsByCall.set(id, results);
  return undefined;
};

const indexAssistantCalls = (
  message: RecordValue,
  index: number,
  callOwners: Map<string, { index: number; name: string }>
): InvalidProtocolResult | undefined => {
  for (const call of toolCalls(message)) {
    const id = toolCallId(call);
    if (!id || callOwners.has(id)) {
      return invalid(
        `Assistant tool calls at context entry ${index} have missing or duplicate IDs.`
      );
    }
    callOwners.set(id, {
      index,
      name: typeof call.name === "string" ? call.name : "unknown",
    });
  }
  return undefined;
};
