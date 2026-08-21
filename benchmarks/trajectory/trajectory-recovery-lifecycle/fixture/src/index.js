/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const { ManualClock } = require("./clock");
const { EffectLedger } = require("./effects");
const { JobRepository } = require("./repository");
const { RetryPolicy } = require("./retry-policy");
const { JobStore } = require("./store");
const { JobWorker } = require("./worker");
const { JobQueue } = require("./queue");

function createRunner(jobs, handler, maxAttempts = 3) {
  const clock = new ManualClock();
  const store = new JobStore(jobs);
  const effects = new EffectLedger();
  const repository = new JobRepository(store, clock);
  const worker = new JobWorker({
    handler: (job) => handler(job, effects),
    repository,
    retryPolicy: new RetryPolicy(maxAttempts),
  });
  return {
    clock,
    effects,
    queue: new JobQueue(worker),
    repository,
    store,
    worker,
  };
}

module.exports = { createRunner };
