import { createHash } from "node:crypto";

import { byteLength } from "./content-utils.ts";
import { SCOUT_LABEL_MAX_CHARS } from "./scout-types.ts";
import type { ScoutContextGroup, ScoutGroupKind } from "./scout-types.ts";

const SPEAKER_PREFIX = /^(?<speaker>User|Executor):\s*/u;

const boundedLabel = (value: string) =>
  [...value.replaceAll(/\s+/gu, " ").trim()]
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

export const createScoutContextGroup = (
  originalIndex: number,
  entryIds: string[],
  kind: ScoutGroupKind,
  content: string,
  required: boolean
): ScoutContextGroup => ({
  bytes: byteLength(content),
  content,
  entryIds,
  id: stableId(originalIndex, entryIds, kind, content),
  kind,
  label: labelFor(kind, content),
  originalIndex,
  required,
});

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
