import { afterEach, describe, expect, test } from "bun:test";

import { main } from "../src/cli.ts";

const previousLive = process.env.BENCH_LIVE;

afterEach(() => {
  if (previousLive === undefined) {
    delete process.env.BENCH_LIVE;
  } else {
    process.env.BENCH_LIVE = previousLive;
  }
});

describe("benchmark CLI", () => {
  test("rejects a live run without an explicit --config path", async () => {
    process.env.BENCH_LIVE = "1";

    for (const command of ["decisions", "screen", "evaluate"]) {
      await expect(main([command])).rejects.toThrow("--config");
    }
  });
});
