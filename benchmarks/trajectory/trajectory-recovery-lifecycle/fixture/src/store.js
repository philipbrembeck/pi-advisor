/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const { assertState, snapshot } = require("./state");
const { UnknownJobError } = require("./errors");

class JobStore {
  constructor(jobs = []) {
    this.jobs = new Map();
    for (const job of jobs) {
      assertState(job.status ?? "queued");
      this.jobs.set(job.id, {
        attempts: 0,
        leaseToken: null,
        status: "queued",
        ...job,
      });
    }
  }

  get(id) {
    const job = this.jobs.get(id);
    if (!job) {
      throw new UnknownJobError(id);
    }
    return snapshot(job);
  }

  update(id, changes) {
    const current = this.jobs.get(id);
    if (!current) {
      throw new UnknownJobError(id);
    }
    const next = { ...current, ...changes };
    assertState(next.status);
    this.jobs.set(id, next);
    return snapshot(next);
  }

  all() {
    return [...this.jobs.values()].map(snapshot);
  }
}

module.exports = { JobStore };
