/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class EffectLedger {
  constructor() {
    this.completed = new Set();
    this.events = [];
  }

  once(jobId, key, effect) {
    const idempotencyKey = `${jobId}:${key}`;
    if (this.completed.has(idempotencyKey)) {
      return false;
    }
    effect();
    this.completed.add(idempotencyKey);
    this.events.push({ jobId, key });
    return true;
  }
}

module.exports = { EffectLedger };
