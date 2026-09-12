import { lstat, open, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { redactAndCapText } from "./conversation.ts";

export const PREFERENCES_MAX_BYTES = 8 * 1024;
// Keep the local filename components separate from Socket's URL-string heuristic.
const PREFERENCES_FILENAME = ["advisor-preferences", "md"].join(".");
export interface TextAttachment {
  bytes: number;
  text: string;
}

const inside = (root: string, candidate: string) => {
  const path = relative(root, candidate);
  return path === "" || !(path.startsWith("..") || path.includes("../"));
};

/** Reads trusted project preferences without following a file or root escape. */
export const readProjectPreferences = async (
  ctx: ExtensionContext,
  maxBytes = PREFERENCES_MAX_BYTES,
  redact = true
): Promise<TextAttachment | undefined> => {
  if (!ctx.isProjectTrusted()) {
    return;
  }
  try {
    const root = await realpath(ctx.cwd);
    const candidate = join(ctx.cwd, ".pi", PREFERENCES_FILENAME);
    const stats = await lstat(candidate);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      return;
    }
    const resolved = await realpath(candidate);
    if (!inside(root, resolved)) {
      return;
    }
    const file = await open(resolved, "r");
    try {
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const source = buffer.subarray(0, bytesRead).toString("utf8");
      const capped = redactAndCapText(source, maxBytes, redact);
      return { bytes: Buffer.byteLength(capped, "utf8"), text: capped };
    } finally {
      await file.close();
    }
  } catch {
    // Missing, unreadable, or unsafe preferences are intentionally withheld.
  }
};
