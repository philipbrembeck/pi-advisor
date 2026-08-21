/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createService } = require("../src");

test("a preference update commits with one outbox event", async () => {
  const value = createService([
    { id: "acct-1", preferences: { email: true }, version: 0 },
  ]);
  value.service.update("acct-1", { sms: true });
  assert.equal(value.accountRepository.get("acct-1").version, 1);
  assert.equal(value.outbox.pending().length, 1);
  await value.dispatcher.dispatch();
  assert.equal(value.client.calls.length, 1);
});

test("invalid preferences do not create a change", () => {
  const value = createService([
    { id: "acct-1", preferences: { email: true }, version: 0 },
  ]);
  assert.throws(
    () => value.service.update("acct-1", { fax: true }),
    /invalid preference/
  );
  assert.equal(value.outbox.pending().length, 0);
});
