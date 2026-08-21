/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRunner } = require("../src");

test("successful work reaches a terminal state", async () => {
  const runner = createRunner([{ id: "one", payload: 1 }], async () => {});
  await runner.worker.run("one");
  assert.equal(runner.repository.get("one").status, "succeeded");
  assert.equal(runner.repository.get("one").leaseToken, null);
});

test("a retryable handler error is surfaced to the queue", async () => {
  const runner = createRunner([{ id: "one", payload: 1 }], async () => {
    const error = new Error("temporary");
    error.retryable = true;
    throw error;
  });
  await assert.rejects(() => runner.worker.run("one"), /temporary/);
  assert.equal(runner.repository.get("one").status, "queued");
});
