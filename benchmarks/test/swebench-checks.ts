import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertModelIdentity,
  BenchmarkSetupError,
  captureModelPatch,
  classifyRun,
  failureIsScorable,
  prepareWorkspace,
  protectedTestChanges,
} from "../swebench/adapter.js";
import type { SwebenchTask } from "../swebench/types.js";

const repo = () => {
  const root = mkdtempSync(join(process.cwd(), "swebench-adapter-test-"));
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", [
    "-C",
    root,
    "config",
    "user.email",
    "test@example.invalid",
  ]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
  writeFileSync(join(root, "production.txt"), "base\n");
  writeFileSync(join(root, "tests.txt"), "canonical\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "base"]);
  return {
    commit: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    root,
  };
};
const task = (
  root: string,
  commit: string,
  testPatch = "diff --git a/tests.txt b/tests.txt\n--- a/tests.txt\n+++ b/tests.txt\n@@ -1 +1 @@\n-canonical\n+prepared\n"
): SwebenchTask => ({
  baseCommit: commit,
  failToPass: ["local"],
  id: "local-swebench-task",
  instanceId: "local-swebench-task",
  passToPass: [],
  problemStatement: "Fix production behavior in this repository.",
  repo: root,
  solutionPatch:
    "diff --git a/production.txt b/production.txt\n--- a/production.txt\n+++ b/production.txt\n@@ -1 +1 @@\n-base\n+fixed\n",
  solutionPatchSha256:
    "sha256:" +
    awaitHash(
      "diff --git a/production.txt b/production.txt\n--- a/production.txt\n+++ b/production.txt\n@@ -1 +1 @@\n-base\n+fixed\n"
    ),
  testFiles: ["tests.txt"],
  testPatch,
  testPatchSha256: `sha256:${awaitHash(testPatch)}`,
  validation: {
    args: [
      "-e",
      "process.exit(require('fs').readFileSync('production.txt','utf8').trim() === 'fixed' ? 0 : 1)",
    ],
    program: "node",
  },
  version: "local",
});
const awaitHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("SWE-bench adapter lifecycle", () => {
  test("model edits to canonical test files do not change protected state", async () => {
    const source = repo();
    const root = mkdtempSync(join(process.cwd(), "swebench-cache-test-"));
    try {
      const prepared = await prepareWorkspace(
        task(source.root, source.commit),
        root
      );
      writeFileSync(join(prepared.workspace, "tests.txt"), "model changed\n");
      writeFileSync(join(prepared.workspace, "production.txt"), "fix\n");
      const changed = await protectedTestChanges(
        prepared.workspace,
        prepared.prepared.commit,
        prepared.testFiles
      );
      expect(changed).toEqual(["tests.txt"]);
      const patch = await captureModelPatch(
        prepared,
        join(prepared.root, "model.patch")
      );
      expect(patch.testFilesChanged).toEqual(["tests.txt"]);
      expect(patch.productionFilesChanged).toEqual(["production.txt"]);
      prepared.cleanup();
    } finally {
      rmSync(source.root, { force: true, recursive: true });
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("invalid canonical test patch fails before model setup", async () => {
    const source = repo();
    const root = mkdtempSync(join(process.cwd(), "swebench-cache-test-"));
    try {
      const invalid = task(
        source.root,
        source.commit,
        "diff --git a/missing.txt b/missing.txt\n--- a/missing.txt\n+++ b/missing.txt\n@@ -1 +1 @@\n-nope\n+bad\n"
      );
      await expect(prepareWorkspace(invalid, root)).rejects.toBeInstanceOf(
        BenchmarkSetupError
      );
    } finally {
      rmSync(source.root, { force: true, recursive: true });
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("model identity mismatch is unscorable and timeout never becomes success", () => {
    expect(() =>
      assertModelIdentity("openai-codex/gpt-5.6-sol", "gpt-5.6-luna")
    ).toThrow("PI_MODEL");
    expect(
      classifyRun({ settled: true, timedOut: true, validationPassed: true })
    ).toBe("model-timeout");
    expect(failureIsScorable("model-timeout")).toBe(true);
    expect(failureIsScorable("benchmark-setup-failure")).toBe(false);
  });
});
