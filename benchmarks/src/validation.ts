import { spawn } from "node:child_process";
import type { ValidationResult } from "./types.js";

const MAX_OUTPUT = 4000;
const INVARIANT_PATTERN = /(?:^|\n)invariant:([a-z0-9-]+)/;
const summarize = (value: string) =>
  value.length > MAX_OUTPUT ? `${value.slice(0, MAX_OUTPUT)}…` : value;
const diagnostic = (stdout: string, stderr: string) => {
  const match = INVARIANT_PATTERN.exec(`${stderr}\n${stdout}`);
  return match?.[1];
};
const failureReason = (
  timedOut: boolean,
  exitCode: number | null,
  signal: string | null,
  invariant: string | undefined,
  timeoutSeconds: number
) => {
  if (timedOut) {
    return `validator timed out after ${timeoutSeconds}s`;
  }
  if (exitCode === 0) {
    return;
  }
  return invariant
    ? `validator invariant failed: ${invariant}`
    : `validator exited with ${exitCode ?? signal}`;
};
const result = (
  started: number,
  stdout: string,
  stderr: string,
  timedOut: boolean,
  exitCode: number | null,
  signal: string | null,
  timeoutSeconds: number,
  error?: string
): ValidationResult => {
  const invariant = diagnostic(stdout, stderr);
  const passed = !timedOut && exitCode === 0;
  let failureClass: ValidationResult["failureClass"] = "validation-failure";
  if (timedOut) {
    failureClass = "validator-timeout";
  } else if (passed) {
    failureClass = "success";
  }
  return {
    durationMs: Date.now() - started,
    exitCode,
    failureClass,
    ...(invariant ? { invariant } : {}),
    failureReason:
      error ??
      failureReason(timedOut, exitCode, signal, invariant, timeoutSeconds),
    passed,
    signal: signal ?? undefined,
    stderrSummary: summarize(stderr),
    stdoutSummary: summarize(stdout),
    timedOut,
  };
};

export const runValidator = (
  program: string,
  args: string[],
  cwd: string,
  timeoutSeconds: number,
  env: Record<string, string> = {}
): Promise<ValidationResult> =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [program, ...args], {
      cwd,
      detached: true,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    let timedOut = false;
    let hardKillTimer: ReturnType<typeof setTimeout> | undefined;
    const clearKillTimer = () => {
      if (hardKillTimer) {
        clearTimeout(hardKillTimer);
        hardKillTimer = undefined;
      }
    };
    const killTree = (signal: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The validator may have exited between timeout signals.
        }
      }
      child.kill(signal);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      hardKillTimer = setTimeout(() => killTree("SIGKILL"), 250);
      hardKillTimer.unref();
    }, timeoutSeconds * 1000);
    child.on("error", (error) => {
      clearTimeout(timer);
      clearKillTimer();
      resolve(
        result(
          started,
          stdout,
          stderr,
          timedOut,
          null,
          null,
          timeoutSeconds,
          error.message
        )
      );
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      clearKillTimer();
      resolve(
        result(
          started,
          stdout,
          stderr,
          timedOut,
          exitCode,
          signal,
          timeoutSeconds
        )
      );
    });
  });
