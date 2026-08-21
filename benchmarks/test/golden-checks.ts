import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { discoverTasks } from "../src/task-loader.js";

describe("golden benchmark solutions", () => {
  test("pass every hidden validator", () => {
    const tasks = discoverTasks("benchmarks/tasks");
    for (const task of tasks) {
      const result = spawnSync(process.execPath, [task.validatorPath], {
        cwd: resolve("benchmarks/golden", task.id),
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.status, task.id).toBe(0);
    }
  });
});
