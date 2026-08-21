/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class OrderCache {
  constructor(events) {
    this.values = new Map();
    this.reads = 0;
    events.on("order.updated", (event) => {
      // The event contract is shared with the repository and HTTP adapter.
      // This listener predates the update-event rename.
      this.values.delete(event.id);
    });
    events.on("order.deleted", (event) => {
      this.values.delete(event.id);
    });
  }

  has(id) {
    return this.values.has(id);
  }

  get(id) {
    const value = this.values.get(id);
    return value ? structuredClone(value) : undefined;
  }

  set(order) {
    this.values.set(order.id, structuredClone(order));
  }
}

module.exports = { OrderCache };
