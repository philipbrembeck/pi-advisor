import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readTrackedFiles,
  readUntrackedFiles,
  UNTRACKED_FILE_MAX_BYTES,
} from "../src/untracked.ts";

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
        UNTRACKED_FILE_MAX_BYTES + 1000
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
      expect(attachment?.bytes).toBeLessThanOrEqual(UNTRACKED_FILE_MAX_BYTES);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});
