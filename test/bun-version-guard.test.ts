import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const guardPath = join(projectRoot, "scripts/check-bun-version.mjs");

const runGuard = (
  scriptPath: string,
  cwd: string,
  userAgent: string,
  localPrefix: string
) =>
  spawnSync("node", [scriptPath], {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      npm_config_local_prefix: localPrefix,
      npm_config_user_agent: userAgent,
    },
  });

const withTempDirectory = (run: (directory: string) => void) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-advisor-bun-guard-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

describe("Bun install version guard", () => {
  test("rejects versions older than 1.4.3", () => {
    withTempDirectory((cwd) => {
      const result = runGuard(guardPath, cwd, "bun/1.4.2 npm/?", projectRoot);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("requires Bun 1.4.3 or newer");
    });
  });

  test("accepts the minimum and newer Bun releases", () => {
    withTempDirectory((cwd) => {
      const minimum = runGuard(guardPath, cwd, "bun/1.4.3 npm/?", projectRoot);
      const newer = runGuard(
        guardPath,
        cwd,
        "bun/1.5.0-canary.1 npm/?",
        projectRoot
      );
      expect(minimum.status).toBe(0);
      expect(newer.status).toBe(0);
    });
  });

  test("rejects a prerelease of the minimum version", () => {
    withTempDirectory((cwd) => {
      const result = runGuard(
        guardPath,
        cwd,
        "bun/1.4.3-canary.1 npm/?",
        projectRoot
      );
      expect(result.status).toBe(1);
    });
  });

  test("rejects non-Bun package managers in the repository", () => {
    withTempDirectory((cwd) => {
      const result = runGuard(
        guardPath,
        cwd,
        "npm/11.4.2 node/v24",
        projectRoot
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("a non-Bun package manager");
    });
  });

  test("skips lifecycle runs for a package installed as a dependency", () => {
    withTempDirectory((consumerRoot) => {
      const result = runGuard(
        guardPath,
        consumerRoot,
        "npm/11.4.2 node/v24",
        consumerRoot
      );
      expect(result.status).toBe(0);
    });
  });

  test("skips packed consumers without the repository lockfile", () => {
    withTempDirectory((consumerRoot) => {
      const scripts = join(consumerRoot, "scripts");
      mkdirSync(scripts);
      const consumerGuard = join(scripts, "check-bun-version.mjs");
      copyFileSync(guardPath, consumerGuard);
      writeFileSync(
        join(consumerRoot, "package.json"),
        JSON.stringify({ packageManager: "bun@1.4.3" })
      );

      const result = runGuard(
        consumerGuard,
        consumerRoot,
        "npm/11.4.2 node/v24",
        consumerRoot
      );
      expect(result.status).toBe(0);
    });
  });
});
