import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { isString } from "./content-utils.ts";
import { redactAndCapText } from "./redaction.ts";

export const ADVISOR_FILE_MAX_BYTES = 8 * 1024;
const ADVISOR_FILES_TOTAL_MAX_BYTES = 24 * 1024;

export interface UntrackedAttachment {
  bytes: number;
  path: string;
  text: string;
}

const imageExtensions = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

export const imageMime = (path: string) =>
  imageExtensions.get(path.slice(path.lastIndexOf(".")).toLowerCase());

export const imageFileCandidate = (path: string) =>
  Boolean(imageMime(path)) || /\.(?:avif|bmp|heic|svg|tiff?)$/iu.test(path);

const PATH_SEGMENTS = /[\\/]/u;

export const within = (root: string, candidate: string) => {
  const path = relative(root, candidate);

  return path !== "" && !path.startsWith("..") && !path.includes("../");
};

const normalizeRelativePath = (root: string, path: string) =>
  relative(root, resolve(root, path));

export const normalizeRequestedPath = (root: string, value: string) => {
  if (
    !isString(value) ||
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
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
    windowsHide: true,
  });

export const repositoryRoot = (cwd: string) => {
  try {
    return realpath(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
  } catch {
    return Promise.resolve();
  }
};

const MEMBERSHIP_QUERY_BATCH = 256;

const normalizeAll = (root: string, paths: readonly string[]) =>
  new Set(paths.map((path) => normalizeRelativePath(root, path)));

export const permittedPaths = (
  root: string,
  paths: readonly string[],
  kind: "tracked" | "untracked"
): Set<string> => {
  const wanted = normalizeAll(root, paths);
  const permitted = new Set<string>();

  for (let start = 0; start < paths.length; start += MEMBERSHIP_QUERY_BATCH) {
    const batch = paths.slice(start, start + MEMBERSHIP_QUERY_BATCH);

    const output =
      kind === "tracked"
        ? git(root, ["ls-files", "--stage", "-z", "--", ...batch])
        : git(root, [
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            ...batch,
          ]);

    for (const entry of output.split("\0")) {
      if (!entry) {
        continue;
      }

      const name = kind === "tracked" ? (entry.split("\t")[1] ?? "") : entry;

      if (kind === "tracked" && entry.startsWith("160000 ")) {
        continue;
      }

      const normalized = normalizeRelativePath(root, name);

      if (wanted.has(normalized)) {
        permitted.add(normalized);
      }
    }
  }

  return permitted;
};

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

  // fs.open needs combined numeric flags for O_NOFOLLOW; O_RDONLY (0) and O_NOFOLLOW occupy disjoint bits, so + is exact.
  const flags = constants.O_NOFOLLOW
    ? constants.O_RDONLY + constants.O_NOFOLLOW
    : constants.O_RDONLY;

  const file = await open(resolved, flags);

  try {
    const openedStats = await file.stat();

    if (!openedStats.isFile()) {
      return;
    }

    const buffer = Buffer.alloc(available + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const raw = buffer.subarray(0, bytesRead).toString("utf-8");

    if (raw.includes("\0")) {
      return;
    }

    const text = redactAndCapText(raw, available, redact);

    return {
      bytes: Buffer.byteLength(text, "utf-8"),
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

  for (const name of requested) {
    const normalizedName = normalizeRequestedPath(root, name);

    if (
      !normalizedName ||
      unique.has(normalizedName) ||
      imageFileCandidate(normalizedName)
    ) {
      continue;
    }

    unique.add(normalizedName);
  }

  let permitted: Set<string>;

  try {
    permitted = permittedPaths(root, [...unique], kind);
  } catch {
    return [];
  }

  const attachments: UntrackedAttachment[] = [];
  let total = 0;

  for (const normalizedName of unique) {
    try {
      if (!permitted.has(normalizedName)) {
        continue;
      }

      const available = Math.min(ADVISOR_FILE_MAX_BYTES, totalLimit - total);

      if (available <= 0) {
        break;
      }

      // Sequentially enforce the aggregate disclosure budget.
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
