import { execFile } from "node:child_process";

import { isString } from "./content-utils.ts";

/** How much repository change context may leave the machine. */
export type GitContextLevel = "off" | "summary" | "full";

export const GIT_CONTEXT_LEVELS: GitContextLevel[] = ["off", "summary", "full"];

const GIT_CONTEXT_LEVEL_SET = new Set<string>(GIT_CONTEXT_LEVELS);

export const isValidGitContextLevel = (
  value: unknown
): value is GitContextLevel =>
  isString(value) && GIT_CONTEXT_LEVEL_SET.has(value);

const LEVEL_RANK: Record<GitContextLevel, number> = {
  full: 2,
  off: 0,
  summary: 1,
};

/** The Executor may narrow but never widen the user's disclosure allowance. */
export const clampGitContextLevel = (
  requested: GitContextLevel,
  allowed: GitContextLevel
): GitContextLevel =>
  LEVEL_RANK[requested] <= LEVEL_RANK[allowed] ? requested : allowed;

type GitContextStatus =
  "disabled" | "no-changes" | "collected" | "not-a-repository" | "failed";

export interface GitContextResult {
  /** Why collection produced nothing, for diagnostics. Never sent verbatim. */
  detail?: string;
  /** The level actually collected after clamping. */
  level: GitContextLevel;
  status: GitContextStatus;
  /** Collected context, not yet escaped or capped. Empty when nothing is disclosed. */
  text: string;
}

/**
 * Repository text is attacker-influenced and is embedded in a tagged region.
 * A path can reproduce a closing tag verbatim: a directory named `x<` holding a
 * file named `repository_changes>` prints as `x</repository_changes>`, which
 * would end the region early and promote the remainder to trusted instructions.
 */
export const escapeRepositoryText = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const TRUNCATION_NOTICE =
  "\n[Repository context truncated: it exceeded the configured limit.]";

/** Caps the fully rendered region and states plainly that content was dropped. */
export const capRepositoryContext = (value: string, maxChars: number) => {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }

  const contentChars = Math.max(0, maxChars - TRUNCATION_NOTICE.length);

  return {
    text:
      maxChars < TRUNCATION_NOTICE.length
        ? TRUNCATION_NOTICE.slice(0, maxChars)
        : `${value.slice(0, contentChars)}${TRUNCATION_NOTICE}`,
    truncated: true,
  };
};

// git's own empty-tree object, used to diff a repository with no commits yet.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const GIT_TOTAL_TIMEOUT_MS = 5000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

interface GitExecOptions {
  cwd: string;
  encoding: "utf-8";
  maxBuffer: number;
  shell: false;
  timeout: number;
  windowsHide: boolean;
}

// SAFETY: execFile is callback-based; this adapter resolves exactly once.
const execFileText = (
  file: string,
  args: readonly string[],
  options: GitExecOptions
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    // SAFETY: execFile accepts the readonly argument list without mutation.
    execFile(
      file,
      args as string[],
      options,
      (error: Error | null, stdout: string | Buffer) => {
        if (error) {
          reject(error);

          return;
        }

        resolve(String(stdout));
      }
    );
  });

// Never use a shell: arguments are fixed and must not be re-parsed.
const execGit = (args: string[], cwd: string, timeoutMs: number) =>
  execFileText("git", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: GIT_MAX_BUFFER,
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
  });

/** Shares one deadline across commands so a pathological repository cannot block for the sum of per-command timeouts. */
const deadlineRunner = (): GitRunner => {
  const expiresAt = Date.now() + GIT_TOTAL_TIMEOUT_MS;

  return (args, cwd) => {
    const remaining = expiresAt - Date.now();

    if (remaining <= 0) {
      throw new Error("Git context collection exceeded its time budget.");
    }

    return execGit(args, cwd, remaining);
  };
};

/** Resolves the base revision, falling back to the empty tree before any commit. */
const diffBase = async (run: GitRunner, cwd: string): Promise<string> => {
  try {
    await run(["rev-parse", "--verify", "--quiet", "HEAD"], cwd);

    return "HEAD";
  } catch {
    return EMPTY_TREE;
  }
};

/** Collects staged and unstaged changes vs HEAD; summary omits diff hunk headers because git derives them from untouched lines that can reproduce secrets. */
export const collectGitContext = async (
  cwd: string,
  level: GitContextLevel,
  maxChars: number,
  redact: (value: string) => string = (value) => value,
  run: GitRunner = deadlineRunner()
): Promise<GitContextResult> => {
  if (level === "off" || maxChars <= 0) {
    return { level: "off", status: "disabled", text: "" };
  }

  try {
    await run(["rev-parse", "--is-inside-work-tree"], cwd);
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : String(error),
      level,
      status: "not-a-repository",
      text: "",
    };
  }

  try {
    const base = await diffBase(run, cwd);
    const nameStatusOutput = await run(["diff", "--name-status", base], cwd);
    const shortstatOutput = await run(["diff", "--shortstat", base], cwd);

    const untrackedOutput = await run(
      ["ls-files", "--others", "--exclude-standard"],
      cwd
    );

    const nameStatus = nameStatusOutput.trim();
    const shortstat = shortstatOutput.trim();
    const untracked = untrackedOutput.trim();

    if (!(nameStatus || untracked)) {
      return { level, status: "no-changes", text: "" };
    }

    const sections = [
      "Working-tree changes against the last commit (staged and unstaged).",
      nameStatus ? `Changed files:\n${nameStatus}` : "",
      shortstat ? `Totals: ${shortstat}` : "",
      untracked
        ? `Untracked files (names only, contents withheld):\n${untracked}`
        : "",
    ];

    if (level === "full") {
      const patch = await run(["diff", base], cwd);
      sections.push(
        patch.trim()
          ? `Patch:\n${patch}`
          : "Patch: (no tracked-file content changes)"
      );
    } else {
      sections.push(
        "Full patch withheld by configuration; file contents were not disclosed."
      );
    }

    // Redaction runs before the caller caps the region, so a limit can never
    // split a secret and leave a readable fragment behind.
    return {
      level,
      status: "collected",
      text: redact(sections.filter(Boolean).join("\n\n")),
    };
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : String(error),
      level,
      status: "failed",
      text: "",
    };
  }
};
