/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class DeliveryLog {
  constructor() {
    this.accepted = new Set();
  }

  has(key) {
    return this.accepted.has(key);
  }

  record(key) {
    this.accepted.add(key);
  }
}

module.exports = { DeliveryLog };
