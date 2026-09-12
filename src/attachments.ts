import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { redactAndCapText } from "./conversation.ts";

export const ADVISOR_FILE_MAX_BYTES = 8 * 1024;
const ADVISOR_FILES_TOTAL_MAX_BYTES = 24 * 1024;
export interface UntrackedAttachment {
  bytes: number;
  path: string;
  text: string;
}

const PATH_SEGMENTS = /[\\/]/;

const within = (root: string, candidate: string) => {
  const path = relative(root, candidate);
  return path !== "" && !path.startsWith("..") && !path.includes("../");
};
const normalizeRelativePath = (root: string, path: string) =>
  relative(root, resolve(root, path));

const normalizeRequestedPath = (root: string, value: unknown) => {
  if (
    typeof value !== "string" ||
    !value ||
    isAbsolute(value) ||
    value.split(PATH_SEGMENTS).includes("..")
  ) {
    return;
  }
  return normalizeRelativePath(root, value);
};

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
    windowsHide: true,
  });

const repositoryRoot = (cwd: string) => {
  try {
    return realpath(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
  } catch {
    return Promise.resolve(undefined);
  }
};

const untracked = (cwd: string, path: string) => {
  const output = git(cwd, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    path,
  ]);
  const expected = normalizeRelativePath(cwd, path);
  return output
    .split("\0")
    .filter(Boolean)
    .some((entry) => normalizeRelativePath(cwd, entry) === expected);
};

const tracked = (cwd: string, path: string) => {
  const output = git(cwd, ["ls-files", "--stage", "-z", "--", path]);
  const expected = normalizeRelativePath(cwd, path);
  return output.split("\0").some((entry) => {
    if (!entry) {
      return false;
    }
    const [metadata, name] = entry.split("\t");
    return (
      name &&
      normalizeRelativePath(cwd, name) === expected &&
      !metadata.startsWith("160000 ")
    );
  });
};

const isPermitted = (
  root: string,
  path: string,
  kind: "tracked" | "untracked"
) => (kind === "tracked" ? tracked(root, path) : untracked(root, path));

const readAttachment = async (
  root: string,
  normalizedName: string,
  redact: boolean,
  available: number
): Promise<UntrackedAttachment | undefined> => {
  const absolute = resolve(root, normalizedName);
  if (!(within(root, absolute) && available > 0)) {
    return;
  }
  const stats = await lstat(absolute);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    return;
  }
  const resolved = await realpath(absolute);
  if (!within(root, resolved)) {
    return;
  }
  const flags = constants.O_NOFOLLOW
    ? // biome-ignore lint/suspicious/noBitwiseOperators: fs.open requires numeric flags for O_NOFOLLOW.
      constants.O_RDONLY | constants.O_NOFOLLOW
    : constants.O_RDONLY;
  const file = await open(resolved, flags);
  try {
    const openedStats = await file.stat();
    if (!openedStats.isFile()) {
      return;
    }
    const buffer = Buffer.alloc(available + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const raw = buffer.subarray(0, bytesRead).toString("utf8");
    if (raw.includes("\0")) {
      return;
    }
    const text = redactAndCapText(raw, available, redact);
    return {
      bytes: Buffer.byteLength(text, "utf8"),
      path: normalizedName,
      text,
    };
  } finally {
    await file.close();
  }
};

/** Reads exact, permitted regular-file bodies. Refusals are silent. */
const readFiles = async (
  cwd: string,
  requested: string[],
  enabled: boolean,
  redact: boolean,
  kind: "tracked" | "untracked",
  totalLimit = ADVISOR_FILES_TOTAL_MAX_BYTES
): Promise<UntrackedAttachment[]> => {
  if (!(enabled && Array.isArray(requested))) {
    return [];
  }
  const root = await repositoryRoot(cwd);
  if (!root) {
    return [];
  }
  const unique = new Set<string>();
  const attachments: UntrackedAttachment[] = [];
  let total = 0;
  for (const name of requested) {
    const normalizedName = normalizeRequestedPath(root, name);
    if (!normalizedName || unique.has(normalizedName)) {
      continue;
    }
    unique.add(normalizedName);
    try {
      if (!isPermitted(root, normalizedName, kind)) {
        continue;
      }
      const available = Math.min(ADVISOR_FILE_MAX_BYTES, totalLimit - total);
      if (available <= 0) {
        break;
      }
      // Sequentially enforce the aggregate disclosure budget.
      // biome-ignore lint/performance/noAwaitInLoops: each accepted file consumes the remaining budget.
      const attachment = await readAttachment(
        root,
        normalizedName,
        redact,
        available
      );
      if (attachment) {
        attachments.push(attachment);
        total += attachment.bytes;
      }
    } catch {
      /* refuse unreadable or non-git paths */
    }
  }
  return attachments;
};

/** Reads exact tracked working-tree files only when explicitly enabled. */
export const readTrackedFiles = (
  cwd: string,
  requested: string[],
  enabled: boolean,
  redact: boolean,
  totalLimit = ADVISOR_FILES_TOTAL_MAX_BYTES
) => readFiles(cwd, requested, enabled, redact, "tracked", totalLimit);

/** Returns exact, permitted untracked regular-file bodies. Refusals are silent. */
export const readUntrackedFiles = (
  cwd: string,
  requested: string[],
  enabled: boolean,
  redact: boolean,
  totalLimit = ADVISOR_FILES_TOTAL_MAX_BYTES
) => readFiles(cwd, requested, enabled, redact, "untracked", totalLimit);
