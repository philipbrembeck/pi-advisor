/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class AuditLog {
  constructor(events) {
    this.entries = [];
    events.on("order.updated", (event) => {
      this.entries.push({
        id: event.orderId,
        status: event.order.status,
        type: "updated",
      });
    });
    events.on("order.deleted", (event) => {
      this.entries.push({ id: event.id, type: "deleted" });
    });
  }
}

module.exports = { AuditLog };
