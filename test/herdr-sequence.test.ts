import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const sharedUrl = new URL("../src/herdr-shared.ts", import.meta.url).href;

const runSequenceProbe = (body: string) => {
  const child = spawnSync(
    "node",
    [
      "--input-type=module",
      "--eval",
      `import assert from "node:assert/strict";
let clock = Date.now();
Date.now = () => clock;
${body}`,
    ],
    {
      encoding: "utf-8",
      env: { ...process.env, HERDR_ENV: "0" },
      timeout: 5000,
    }
  );

  expect({
    exitCode: child.status,
    output: child.stdout + child.stderr,
  }).toEqual({
    exitCode: 0,
    output: expect.any(String),
  });
};

test("Herdr sequence advances with the clock after module initialization", () => {
  runSequenceProbe(`
const module = await import(${JSON.stringify(sharedUrl)});
const first = module.nextSequence();
const sameClock = module.nextSequence();
assert.ok(sameClock > first);
clock += 10000;
const second = module.nextSequence();
assert.ok(second >= clock * 1000, { first, second, clock });
assert.ok(second > sameClock);
`);
});

test("independently evaluated Herdr modules share the sequence through clock rollback", () => {
  runSequenceProbe(`
const firstModule = await import(${JSON.stringify(`${sharedUrl}?sequence=first`)});
const first = firstModule.nextSequence();
clock -= 10000;
const secondModule = await import(${JSON.stringify(`${sharedUrl}?sequence=second`)});
assert.notEqual(firstModule.nextSequence, secondModule.nextSequence);
const second = secondModule.nextSequence();
const third = firstModule.nextSequence();
assert.ok(second > first, { first, second });
assert.ok(third > second, { second, third });
`);
});
