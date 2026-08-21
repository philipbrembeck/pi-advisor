/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
import { pathToFileURL } from "node:url";

const fail = (caseName: string): never => {
  process.stderr.write(`reasoning-05 failed: ${caseName}\n`);
  process.exit(1);
};
const { enqueue, processNext, resetQueue, resetStore, size } = await import(
  pathToFileURL(`${process.cwd()}/src/index.ts`).href
);
resetQueue();
resetStore();
enqueue({ id: "job-a", payload: "alpha" });
enqueue({ id: "job-b", payload: "beta" });
let first = true;
try {
  await processNext(async (job) => {
    await Promise.resolve();
    if (job.id !== "job-a" || !first) {
      fail("initial job identity");
    }
    first = false;
    throw new Error("temporary");
  });
  fail("failure must requeue");
} catch (error) {
  if (!(error instanceof Error) || error.message !== "temporary") {
    fail("error identity");
  }
}
const retried = await processNext(async (job) => {
  await Promise.resolve();
  if (job.id !== "job-a") {
    fail("retry identity");
  }
  return "A";
});
if (
  retried?.id !== "job-a" ||
  retried.attempts !== 2 ||
  retried.value !== "A"
) {
  fail("retry completion");
}
const other = await processNext(async (job) => {
  await Promise.resolve();
  if (job.id !== "job-b" || job.payload !== "beta") {
    fail("unrelated job");
  }
  return "B";
});
if (other?.id !== "job-b" || other.value !== "B" || other.attempts !== 1) {
  fail("unrelated completion");
}
enqueue({ id: "job-a", payload: "duplicate" });
const duplicate = await processNext(async () => fail("duplicate was executed"));
if (duplicate?.status !== "duplicate" || duplicate.attempts !== 2) {
  fail("duplicate idempotency");
}
if (size() !== 0) {
  fail("queue drained");
}
