/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class ManualClock {
  constructor(now = 1_700_000_000_000) {
    this.value = now;
  }

  now() {
    return this.value;
  }

  advance(ms) {
    this.value += ms;
  }
}

module.exports = { ManualClock };
