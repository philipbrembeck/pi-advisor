/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createOrderApi } = require("../src");

function api() {
  return createOrderApi([
    { id: "a", status: "open", total: 10 },
    { id: "b", status: "open", total: 20 },
  ]);
}

test("reads are cached after the first lookup", async () => {
  const value = api();
  assert.equal((await value.service.get("a")).total, 10);
  assert.equal((await value.service.get("a")).total, 10);
  assert.equal(value.repository.readCount, 1);
});

test("update returns the new representation", async () => {
  const value = api();
  await value.service.get("a");
  const updated = await value.service.update("a", { status: "paid" });
  assert.equal(updated.status, "paid");
});
