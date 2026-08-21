const { createRunner } = require(`${process.cwd()}/src`);

let calls = 0;
const runner = createRunner([{ id: "retry", payload: 1 }], (job, effects) => {
  effects.once(job.id, "send-email", () => {
    // The side effect is intentionally represented by the ledger.
  });
  calls += 1;
  if (calls === 1) {
    const error = new Error("temporary provider failure");
    error.retryable = true;
    throw error;
  }
});
try {
  await runner.worker.run("retry");
  process.exit(1);
} catch (error) {
  if (error.message !== "temporary provider failure") {
    process.exit(1);
  }
}
let state = runner.repository.get("retry");
if (
  state.status !== "queued" ||
  state.leaseToken !== null ||
  state.attempts !== 1
) {
  process.exit(1);
}
await runner.worker.run("retry");
state = runner.repository.get("retry");
if (
  state.status !== "succeeded" ||
  state.leaseToken !== null ||
  state.attempts !== 2
) {
  process.exit(1);
}
if (runner.effects.events.length !== 1) {
  process.exit(1);
}
const skipped = await runner.worker.run("retry");
if (!skipped.skipped || runner.repository.get("retry").attempts !== 2) {
  process.exit(1);
}

const permanent = createRunner(
  [{ id: "bad" }],
  () => {
    throw new Error("permanent");
  },
  1
);
await permanent.queue.drain(["bad"]);
if (permanent.repository.get("bad").status !== "failed") {
  process.exit(1);
}
if (permanent.repository.get("bad").leaseToken !== null) {
  process.exit(1);
}
const afterFailure = await permanent.worker.run("bad");
if (!afterFailure.skipped) {
  process.exit(1);
}

const concurrent = createRunner([{ id: "one" }], async () => {
  await new Promise((resolve) => setTimeout(resolve, 5));
});
const results = await Promise.all([
  concurrent.worker.run("one"),
  concurrent.worker.run("one"),
]);
if (results.filter((result) => result.skipped).length !== 1) {
  process.exit(1);
}
