import { type ChildProcess, spawn } from "node:child_process";

export interface ProcessCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer: number;
  timeoutMs: number;
}

export interface ProcessCommandResult {
  stderr: string;
  stdout: string;
}

const signalProcessTree = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    // The process may have exited between the timeout and the signal.
  }
};

export const runProcess = (
  command: string,
  args: string[],
  options: ProcessCommandOptions
) => {
  if (!command.trim()) {
    throw new TypeError("Process command is required.");
  }
  if (!Number.isFinite(options.maxBuffer) || options.maxBuffer <= 0) {
    throw new TypeError("Process maxBuffer must be positive.");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new TypeError("Process timeoutMs must be positive.");
  }

  return new Promise<ProcessCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let outputLimitExceeded = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const output = () => ({
      stderr: stderr.join(""),
      stdout: stdout.join(""),
    });
    const finish = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
    };
    const terminate = () => {
      signalProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => {
        signalProcessTree(child, "SIGKILL");
      }, 5000);
    };
    const failForOutputLimit = () => {
      if (outputLimitExceeded) {
        return;
      }
      outputLimitExceeded = true;
      terminate();
    };
    const append = (target: string[], chunk: Buffer | string) => {
      const text = chunk.toString();
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > options.maxBuffer) {
        failForOutputLimit();
        return;
      }
      target.push(text);
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: Buffer | string) => append(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer | string) => append(stderr, chunk));
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      finish();
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      finish();
      const captured = output();
      if (timedOut || outputLimitExceeded) {
        // The leader can close before a descendant does; force the whole
        // detached process group down before clearing the kill fallback.
        signalProcessTree(child, "SIGKILL");
      }
      if (timedOut) {
        reject(
          Object.assign(
            new Error(`Process timed out after ${options.timeoutMs} ms.`),
            {
              code: "ETIMEDOUT",
              killed: true,
              ...captured,
              signal,
            }
          )
        );
        return;
      }
      if (outputLimitExceeded) {
        reject(
          Object.assign(
            new Error(
              `Process output exceeded the ${options.maxBuffer}-byte limit.`
            ),
            {
              code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
              killed: true,
              ...captured,
              signal,
            }
          )
        );
        return;
      }
      if (code !== 0) {
        reject(
          Object.assign(
            new Error(
              `Process failed with exit code ${code ?? signal ?? "unknown"}.`
            ),
            { code, ...captured, signal }
          )
        );
        return;
      }
      resolve(captured);
    });
    timeoutTimer = setTimeout(() => {
      if (settled) {
        return;
      }
      timedOut = true;
      terminate();
    }, options.timeoutMs);
  });
};
