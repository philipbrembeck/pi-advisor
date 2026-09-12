import { execFileSync } from "node:child_process";

/** How much repository change context may leave the machine. */
export type GitContextLevel = "off" | "summary" | "full";

export const GIT_CONTEXT_LEVELS: GitContextLevel[] = ["off", "summary", "full"];

export const isValidGitContextLevel = (
  value: unknown
): value is GitContextLevel =>
  GIT_CONTEXT_LEVELS.includes(value as GitContextLevel);

const LEVEL_RANK: Record<GitContextLevel, number> = {
  full: 2,
  off: 0,
  summary: 1,
};

/**
 * The Executor may request no more repository context than the user configured.
 * A model cannot widen its own disclosure allowance.
 */
export const clampGitContextLevel = (
  requested: GitContextLevel,
  allowed: GitContextLevel
): GitContextLevel =>
  LEVEL_RANK[requested] <= LEVEL_RANK[allowed] ? requested : allowed;

type GitContextStatus =
  | "disabled"
  | "no-changes"
  | "collected"
  | "not-a-repository"
  | "failed";

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
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

export type GitRunner = (args: string[], cwd: string) => string;

/**
 * Collection runs several git commands. A per-command timeout alone would let a
 * pathological repository block for the sum of them, so the budget is shared:
 * each command may use only the time remaining before the overall deadline.
 */
const deadlineRunner = (): GitRunner => {
  const expiresAt = Date.now() + GIT_TOTAL_TIMEOUT_MS;
  return (args, cwd) => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      throw new Error("Git context collection exceeded its time budget.");
    }
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER,
      // Never use a shell: arguments are fixed and must not be re-parsed.
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: remaining,
      windowsHide: true,
    });
  };
};

/** Resolves the base revision, falling back to the empty tree before any commit. */
const diffBase = (run: GitRunner, cwd: string): string => {
  try {
    run(["rev-parse", "--verify", "--quiet", "HEAD"], cwd);
    return "HEAD";
  } catch {
    return EMPTY_TREE;
  }
};

/**
 * Collects working-tree changes relative to HEAD, covering staged and unstaged
 * work. Untracked files are reported by name only and never by content.
 *
 * `summary` discloses file names, change status, and line counts. It must not
 * include diff hunk headers: git derives those from surrounding file content,
 * so they can reproduce a secret from a line the change never touched.
 */
export const collectGitContext = (
  cwd: string,
  level: GitContextLevel,
  maxChars: number,
  redact: (value: string) => string = (value) => value,
  run: GitRunner = deadlineRunner()
): GitContextResult => {
  if (level === "off" || maxChars <= 0) {
    return { level: "off", status: "disabled", text: "" };
  }
  try {
    run(["rev-parse", "--is-inside-work-tree"], cwd);
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : String(error),
      level,
      status: "not-a-repository",
      text: "",
    };
  }

  try {
    const base = diffBase(run, cwd);
    const nameStatus = run(["diff", "--name-status", base], cwd).trim();
    const shortstat = run(["diff", "--shortstat", base], cwd).trim();
    const untracked = run(
      ["ls-files", "--others", "--exclude-standard"],
      cwd
    ).trim();

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
      const patch = run(["diff", base], cwd);
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
