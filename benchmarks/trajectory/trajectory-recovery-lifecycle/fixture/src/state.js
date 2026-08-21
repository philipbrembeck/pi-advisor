/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const STATES = new Set(["queued", "running", "succeeded", "failed"]);

function assertState(value) {
  if (!STATES.has(value)) {
    throw new Error(`invalid job state ${value}`);
  }
}

function snapshot(job) {
  return { ...job };
}

module.exports = { assertState, STATES, snapshot };
