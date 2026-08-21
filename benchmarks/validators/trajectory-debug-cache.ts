const { createOrderApi } = require(`${process.cwd()}/src`);

const fail = (invariant: string): never => {
  process.stderr.write(`invariant:${invariant}\n`);
  process.exit(1);
};
const api = createOrderApi([
  { id: "a", status: "open", total: 10 },
  { id: "b", status: "open", total: 20 },
]);
await api.service.get("a");
await api.service.get("b");
const readsAfterWarmup = api.repository.readCount;
const updated = await api.service.update("a", { status: "paid" });
if (updated.status !== "paid") {
  fail("stale-updated-entity");
}
const fresh = await api.service.get("a");
if (fresh.status !== "paid") {
  fail("stale-updated-entity");
}
if (api.repository.readCount !== readsAfterWarmup + 1) {
  fail("incorrect-repository-read-count");
}
if ((await api.service.get("b")).status !== "open") {
  fail("unrelated-cache-invalidated");
}
if (api.repository.readCount !== readsAfterWarmup + 1) {
  fail("incorrect-repository-read-count");
}
const errorBefore = await api.service.get("a");
try {
  await api.service.update("missing", { status: "paid" });
  fail("wrong-error-contract");
} catch (error) {
  if (error.name !== "NotFoundError" || error.code !== "ORDER_NOT_FOUND") {
    fail("wrong-error-contract");
  }
}
if ((await api.service.get("a")).status !== errorBefore.status) {
  fail("failed-update-mutated-entity");
}
await api.service.remove("a");
try {
  await api.service.get("a");
  fail("remove-did-not-invalidate-cache");
} catch (error) {
  if (error.name !== "NotFoundError") {
    fail("remove-did-not-invalidate-cache");
  }
}
