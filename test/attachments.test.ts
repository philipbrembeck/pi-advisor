import { describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as childProcess from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ADVISOR_FILE_MAX_BYTES,
  readTrackedFiles,
  readUntrackedFiles,
} from "../src/attachments.ts";

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "ignore" });

describe("Advisor file attachments", () => {
  test("reads current tracked working-tree files only with explicit consent", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-tracked-"));
    git(cwd, ["init"]);
    writeFileSync(join(cwd, "review.md"), "tracked body");
    git(cwd, ["add", "review.md"]);
    git(cwd, [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "commit",
      "-m",
      "initial",
    ]);
    writeFileSync(join(cwd, "review.md"), "unstaged body");
    writeFileSync(join(cwd, "new.md"), "untracked body");

    try {
      expect(
        await readTrackedFiles(cwd, ["review.md", "new.md"], true, true)
      ).toEqual([{ bytes: 13, path: "review.md", text: "unstaged body" }]);
      expect(await readTrackedFiles(cwd, ["review.md"], false, true)).toEqual(
        []
      );
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test("rejects binary tracked files", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-tracked-"));
    git(cwd, ["init"]);
    writeFileSync(join(cwd, "image.bin"), Buffer.from([1, 0, 2]));
    git(cwd, ["add", "image.bin"]);
    git(cwd, [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "commit",
      "-m",
      "initial",
    ]);

    try {
      expect(await readTrackedFiles(cwd, ["image.bin"], true, true)).toEqual(
        []
      );
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test("uses one aggregate budget across tracked attachments", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-tracked-"));
    git(cwd, ["init"]);
    writeFileSync(join(cwd, "a.md"), "a".repeat(10));
    writeFileSync(join(cwd, "b.md"), "b".repeat(10));
    git(cwd, ["add", "."]);
    git(cwd, [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "commit",
      "-m",
      "initial",
    ]);

    try {
      const attachments = await readTrackedFiles(
        cwd,
        ["a.md", "b.md"],
        true,
        true,
        10
      );

      expect(attachments).toHaveLength(1);
      expect(attachments[0]?.bytes).toBe(10);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test("answers a path list with one batched Git membership query", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-untracked-"));
    git(cwd, ["init"]);
    writeFileSync(join(cwd, "one.md"), "one");
    writeFileSync(join(cwd, "two.md"), "two");

    const execCalls: string[][] = [];
    const realExecFileSync = childProcess.execFileSync;

    // SAFETY: shim matches execFileSync's (file, args, options) overload shape.
    const execShim = ((
      file: string,
      args?: readonly string[],
      options?: childProcess.ExecFileSyncOptions
    ) => {
      if (args?.[0] === "ls-files") {
        execCalls.push([...args]);

        return "";
      }

      return realExecFileSync(file, args, options);
    }) as typeof execFileSync;

    const execSpy = spyOn(childProcess, "execFileSync").mockImplementation(
      execShim
    );

    try {
      const attachments = await readUntrackedFiles(
        cwd,
        ["one.md", "two.md", "missing-1.md", "missing-2.md"],
        true,
        true
      );

      expect(attachments).toEqual([]);
      expect(execCalls).toHaveLength(1);
      expect(execCalls[0]).toEqual([
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        "one.md",
        "two.md",
        "missing-1.md",
        "missing-2.md",
      ]);
    } finally {
      execSpy.mockRestore();
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test("reads normalized non-ASCII untracked paths and labels the attachment", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-untracked-"));
    git(cwd, ["init"]);
    writeFileSync(join(cwd, "ü.md"), "content");

    try {
      const attachments = await readUntrackedFiles(cwd, ["./ü.md"], true, true);
      expect(attachments).toEqual([
        { bytes: 7, path: "ü.md", text: "content" },
      ]);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test("redacts PEM content whose closing delimiter is outside the file cap", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-untracked-"));
    git(cwd, ["init"]);
    writeFileSync(
      join(cwd, "secret.pem"),
      `-----BEGIN PRIVATE KEY-----\n${"A".repeat(
        ADVISOR_FILE_MAX_BYTES + 1000
      )}\n-----END PRIVATE KEY-----`
    );

    try {
      const [attachment] = await readUntrackedFiles(
        cwd,
        ["secret.pem"],
        true,
        true
      );

      expect(attachment?.text).toContain("[REDACTED SECRET]");
      expect(attachment?.text).not.toContain("AAAA");
      expect(attachment?.bytes).toBeLessThanOrEqual(ADVISOR_FILE_MAX_BYTES);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test("redacts quoted secrets cut off by the file cap", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-untracked-"));
    git(cwd, ["init"]);
    const secret = "quoted-secret-marker";
    writeFileSync(
      join(cwd, "secret.txt"),
      `password="${secret.repeat(ADVISOR_FILE_MAX_BYTES)}"`
    );

    try {
      const [attachment] = await readUntrackedFiles(
        cwd,
        ["secret.txt"],
        true,
        true
      );

      expect(attachment?.text).toContain("[REDACTED SECRET]");
      expect(attachment?.text).not.toContain(secret);
      expect(attachment?.bytes).toBeLessThanOrEqual(ADVISOR_FILE_MAX_BYTES);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test("redacts a capped quoted secret ending with a backslash", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-untracked-"));
    git(cwd, ["init"]);
    const prefix = 'password="';
    const secret = "trailing-backslash-secret";

    const text = `${prefix}${secret}${"x".repeat(
      ADVISOR_FILE_MAX_BYTES - prefix.length - secret.length
    )}\\`;

    expect(text.length).toBe(ADVISOR_FILE_MAX_BYTES + 1);
    writeFileSync(join(cwd, "secret.txt"), text);

    try {
      const [attachment] = await readUntrackedFiles(
        cwd,
        ["secret.txt"],
        true,
        true
      );

      expect(attachment?.text).toContain("[REDACTED SECRET]");
      expect(attachment?.text).not.toContain(secret);
      expect(attachment?.bytes).toBeLessThanOrEqual(ADVISOR_FILE_MAX_BYTES);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});
