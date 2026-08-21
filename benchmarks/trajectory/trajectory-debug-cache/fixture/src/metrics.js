/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class Metrics {
  constructor() {
    this.counters = new Map();
  }

  increment(name) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
  }

  value(name) {
    return this.counters.get(name) ?? 0;
  }
}

module.exports = { Metrics };
