/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const { randomUUID } = require("node:crypto");

class JobRepository {
  constructor(store, clock, leaseMs = 10_000) {
    this.store = store;
    this.clock = clock;
    this.leaseMs = leaseMs;
  }

  get(id) {
    return this.store.get(id);
  }

  claim(id) {
    const job = this.store.get(id);
    const leaseExpired =
      job.leaseUntil !== undefined && job.leaseUntil <= this.clock.now();
    if (job.status === "succeeded" || job.status === "failed") {
      return null;
    }
    if (job.status === "running" && !leaseExpired) {
      return null;
    }
    const token = randomUUID();
    return this.store.update(id, {
      attempts: job.attempts + 1,
      leaseToken: token,
      leaseUntil: this.clock.now() + this.leaseMs,
      status: "running",
    });
  }

  complete(id, token) {
    const job = this.store.get(id);
    if (job.leaseToken !== token) {
      throw new Error("cannot complete without the active lease");
    }
    return this.store.update(id, {
      leaseToken: null,
      leaseUntil: undefined,
      status: "succeeded",
    });
  }

  fail(id, token, message) {
    const job = this.store.get(id);
    if (job.leaseToken !== token) {
      throw new Error("cannot fail without the active lease");
    }
    return this.store.update(id, {
      error: message,
      leaseToken: null,
      leaseUntil: undefined,
      status: "failed",
    });
  }

  requeue(id, token, message) {
    const job = this.store.get(id);
    if (job.leaseToken !== token) {
      throw new Error("cannot requeue without the active lease");
    }
    return this.store.update(id, {
      error: message,
      leaseToken: null,
      leaseUntil: undefined,
      status: "queued",
    });
  }

  release(id, token) {
    const job = this.store.get(id);
    if (job.leaseToken === token || job.status === "failed") {
      // Release is called from finally so it also runs after fail/requeue.
      return this.store.update(id, {
        leaseToken: null,
        leaseUntil: undefined,
        status: "queued",
      });
    }
    return job;
  }
}

module.exports = { JobRepository };
