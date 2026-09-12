import { createHmac, randomBytes } from "node:crypto";
import {
  appendFile,
  chmod,
  link,
  mkdir,
  open,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type OutcomeAdoption = "followed" | "not-followed" | "unknown";
export type OutcomeValidation = "passed" | "failed" | "not-run" | "unknown";
type OutcomeTrigger = "manual" | "executor-requested" | "repeated-tool-call";
export const ADOPTIONS: OutcomeAdoption[] = [
  "followed",
  "not-followed",
  "unknown",
];
export const VALIDATIONS: OutcomeValidation[] = [
  "passed",
  "failed",
  "not-run",
  "unknown",
];
export interface OutcomeRecord {
  adoption: OutcomeAdoption;
  adviceHash: string;
  timestamp: string;
  trigger: OutcomeTrigger;
  v: 1;
  validationStatus: OutcomeValidation;
}
const MAX_LOG_BYTES = 1024 * 1024;
const statePath = () => join(getAgentDir(), "advisor-outcomes-salt");
export const outcomeLogPath = () =>
  join(getAgentDir(), "advisor-outcomes.jsonl");

const salt = async () => {
  const path = statePath();
  await mkdir(getAgentDir(), { mode: 0o700, recursive: true });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: contenders retry sequentially until one salt is atomically published.
      const existing = await readFile(path);
      if (existing.length === 32) {
        return existing;
      }
      // Recover a salt file left incomplete by an interrupted older writer.
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const value = randomBytes(32);
    const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.${attempt}`;
    await writeFile(temporary, value, { mode: 0o600 });
    try {
      await link(temporary, path);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  throw new Error("Advisor outcome salt initialization did not complete.");
};
const sameFile = (
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint }
) => left.dev === right.dev && left.ino === right.ino;

const withOutcomeLock = async <T>(run: () => Promise<T>): Promise<T> => {
  const lockPath = `${outcomeLogPath()}.lock`;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: lock acquisition must retry sequentially across processes.
      const lock = await open(lockPath, "wx", 0o600);
      const identity = await lock.stat();
      try {
        return await run();
      } finally {
        await lock.close();
        const current = await stat(lockPath).catch(() => undefined);
        if (current && sameFile(identity, current)) {
          await unlink(lockPath).catch(() => undefined);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const observed = await stat(lockPath).catch(() => undefined);
      if (observed && Date.now() - observed.mtimeMs > 30_000) {
        const current = await stat(lockPath).catch(() => undefined);
        if (current && sameFile(observed, current)) {
          await unlink(lockPath).catch(() => undefined);
        }
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error("Timed out waiting to append an Advisor outcome.");
};

const adviceDigest = (advice: string, key: Buffer) =>
  createHmac("sha256", key).update(advice).digest("hex").slice(0, 16);

/** Best-effort, global-only, minimal persistent telemetry. */
export const appendOutcome = async (
  record: Omit<OutcomeRecord, "adviceHash" | "timestamp" | "v"> & {
    advice: string;
  }
) => {
  const path = outcomeLogPath();
  await mkdir(getAgentDir(), { mode: 0o700, recursive: true });
  return withOutcomeLock(async () => {
    const next: OutcomeRecord = {
      adoption: record.adoption,
      adviceHash: adviceDigest(record.advice, await salt()),
      timestamp: new Date().toISOString(),
      trigger: record.trigger,
      v: 1,
      validationStatus: record.validationStatus,
    };
    const line = `${JSON.stringify(next)}\n`;
    const currentBytes = await stat(path)
      .then((value) => value.size)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return 0;
        }
        throw error;
      });
    if (currentBytes + Buffer.byteLength(line) > MAX_LOG_BYTES) {
      await writeFile(path, line, { encoding: "utf8", mode: 0o600 });
    } else {
      await appendFile(path, line, { encoding: "utf8", mode: 0o600 });
    }
    await chmod(path, 0o600);
    return next;
  });
};
