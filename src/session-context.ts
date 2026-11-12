import type {
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

type SessionManagerWithContextEntries = ExtensionContext["sessionManager"] & {
  buildContextEntries?: () => SessionEntry[];
};

const projectBranch = (source: SessionEntry[]): SessionEntry[] => {
  const resetBoundaryIndex = source.findLastIndex((entry) =>
    Object.is(entry.type, "reset_boundary")
  );

  const branch = source.slice(resetBoundaryIndex + 1);

  const compactionIndex = branch.findLastIndex(
    (entry) => entry.type === "compaction"
  );

  if (compactionIndex === -1) {
    return branch;
  }

  const compaction = branch[compactionIndex];

  if (compaction.type !== "compaction") {
    return branch;
  }

  const firstKeptIndex = branch.findIndex(
    (entry, index) =>
      index < compactionIndex && entry.id === compaction.firstKeptEntryId
  );

  const projected: SessionEntry[] = [compaction];

  if (firstKeptIndex !== -1) {
    for (let index = firstKeptIndex; index < compactionIndex; index += 1) {
      const entry = branch[index];

      if (
        entry.type !== "compaction" &&
        !(entry.type === "message" && entry.message.role === "system")
      ) {
        projected.push(entry);
      }
    }
  }

  return [...projected, ...branch.slice(compactionIndex + 1)];
};

export const currentSessionId = (ctx: {
  sessionManager?: { getSessionId?: () => string };
}): string | undefined => ctx.sessionManager?.getSessionId?.();

export const sessionContextEntries = (
  ctx: ExtensionContext
): SessionEntry[] => {
  // SAFETY: older hosts lack projection; retain reset and compaction boundaries before disclosure.
  const sessionManager = ctx.sessionManager as SessionManagerWithContextEntries;

  return sessionManager.buildContextEntries
    ? sessionManager.buildContextEntries()
    : projectBranch(sessionManager.getBranch());
};
