import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { hashTree } from "./task-loader.js";
import type { ResolvedTask } from "./types.js";

const execFileAsync = promisify(execFile);
export interface IsolatedAttempt {
  agentDir: string;
  cleanup: () => void;
  configPath: string;
  fixtureHash: string;
  initialGitCommit: string;
  root: string;
  runId: string;
  workspace: string;
}

const runGit = async (cwd: string, args: string[]) =>
  execFileAsync("git", args, { cwd, maxBuffer: 2 * 1024 * 1024 });

export const createIsolatedAttempt = async (
  task: ResolvedTask,
  configText: string
): Promise<IsolatedAttempt> => {
  const runId = randomUUID();
  const root = mkdtempSync(join(tmpdir(), "pi-benchmark-"));
  const workspace = join(root, "workspace");
  const agentDir = join(root, "agent");
  mkdirSync(agentDir, { recursive: true });
  cpSync(task.fixturePath, workspace, { dereference: false, recursive: true });
  const configPath = join(agentDir, "advisor.json");
  writeFileSync(configPath, configText);
  const fixtureHash = hashTree(workspace);
  await runGit(workspace, ["init", "--quiet"]);
  await runGit(workspace, [
    "config",
    "user.email",
    "benchmark@example.invalid",
  ]);
  await runGit(workspace, ["config", "user.name", "Pi Benchmark"]);
  await runGit(workspace, ["add", "."]);
  await runGit(workspace, [
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  const { stdout } = await runGit(workspace, ["rev-parse", "HEAD"]);
  return {
    agentDir,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    configPath,
    fixtureHash,
    initialGitCommit: stdout.trim(),
    root,
    runId,
    workspace,
  };
};

export const hashText = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const hashJson = (value: unknown) => hashText(JSON.stringify(value));

export const summarizeWorkspace = async (
  workspace: string,
  initialCommit: string
) => {
  try {
    const { stdout } = await runGit(workspace, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "-z",
    ]);
    const rawEntries = stdout.split("\0").filter(Boolean);
    const statusEntries: Array<{ code: string; path: string }> = [];
    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const code = raw.slice(0, 2);
      const path = raw.slice(3);
      if (code.includes("R") || code.includes("C")) {
        const nextPath = rawEntries[index + 1];
        statusEntries.push({ code, path: `${path} -> ${nextPath}` });
        index += 1;
      } else {
        statusEntries.push({ code, path });
      }
    }
    const changedPaths = statusEntries.map((entry) => entry.path).sort();
    const diff = await runGit(workspace, [
      "diff",
      "--binary",
      initialCommit,
    ]).catch(() => ({ stdout: "" }));
    const added = statusEntries.filter(
      (entry) => entry.code === "??" || entry.code.includes("A")
    ).length;
    const deleted = statusEntries.filter((entry) =>
      entry.code.includes("D")
    ).length;
    const untrackedBytes = statusEntries
      .filter((entry) => entry.code === "??")
      .reduce((total, entry) => {
        try {
          return (
            total +
            Buffer.byteLength(readFileSync(resolve(workspace, entry.path)))
          );
        } catch {
          return total;
        }
      }, 0);
    return {
      added,
      changedPaths,
      deleted,
      diffBytes: Buffer.byteLength(diff.stdout) + untrackedBytes,
      modified: Math.max(0, changedPaths.length - added - deleted),
    };
  } catch {
    return {
      added: 0,
      changedPaths: [],
      deleted: 0,
      diffBytes: 0,
      modified: 0,
    };
  }
};

export const serializeIsolationMetadata = (attempt: IsolatedAttempt) => ({
  agentDir: resolve(attempt.agentDir),
  fixtureHash: attempt.fixtureHash,
  initialGitCommit: attempt.initialGitCommit,
  runId: attempt.runId,
  workspacePath: resolve(attempt.workspace),
});
