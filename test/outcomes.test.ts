import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendOutcome, outcomeLogPath } from "../src/outcomes.ts";

describe("outcome log", () => {
  test("writes only the versioned allowlisted privacy-minimal record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-advisor-outcomes-"));
    const prior = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    const advice =
      "raw advice SENTINEL_PROMPT /private/path session-123 tool output";
    try {
      await appendOutcome({
        adoption: "followed",
        advice,
        trigger: "executor-requested",
        validationStatus: "passed",
      });
      const raw = readFileSync(outcomeLogPath(), "utf8");
      const parsed = JSON.parse(raw);
      expect(Object.keys(parsed).sort()).toEqual([
        "adoption",
        "adviceHash",
        "timestamp",
        "trigger",
        "v",
        "validationStatus",
      ]);
      expect(parsed).toMatchObject({
        adoption: "followed",
        trigger: "executor-requested",
        v: 1,
        validationStatus: "passed",
      });
      expect(raw).not.toContain("SENTINEL_PROMPT");
      expect(raw).not.toContain("/private/path");
      expect(raw).not.toContain("session-123");
      chmodSync(outcomeLogPath(), 0o644);
      await appendOutcome({
        adoption: "unknown",
        advice: "second",
        trigger: "manual",
        validationStatus: "not-run",
      });
      expect(statSync(outcomeLogPath()).mode % 0o1000).toBe(0o600);
    } finally {
      if (prior === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = prior;
      }
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("keeps concurrent appends and uses one exclusively created salt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-advisor-outcomes-"));
    const prior = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    try {
      writeFileSync(join(dir, "advisor-outcomes-salt"), "");
      const staleLock = `${outcomeLogPath()}.lock`;
      writeFileSync(staleLock, "");
      const stale = new Date(Date.now() - 60_000);
      utimesSync(staleLock, stale, stale);
      await Promise.all(
        Array.from({ length: 20 }, () =>
          appendOutcome({
            adoption: "unknown",
            advice: "same advice",
            trigger: "manual",
            validationStatus: "not-run",
          })
        )
      );
      const records = readFileSync(outcomeLogPath(), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(records).toHaveLength(20);
      expect(new Set(records.map((record) => record.adviceHash)).size).toBe(1);
    } finally {
      if (prior === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = prior;
      }
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
