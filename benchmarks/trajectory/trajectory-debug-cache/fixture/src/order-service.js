/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const { InvalidOrderError } = require("./errors");

class OrderService {
  constructor({ repository, cache, events }) {
    this.repository = repository;
    this.cache = cache;
    this.events = events;
  }

  async get(id) {
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }
    const order = await this.repository.findById(id);
    this.cache.set(order);
    return order;
  }

  async update(id, patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new InvalidOrderError("an update patch is required");
    }
    const updated = await this.repository.update(id, patch);
    await this.events.publish({
      order: updated,
      orderId: updated.id,
      type: "order.updated",
    });
    return updated;
  }

  async remove(id) {
    await this.repository.remove(id);
    await this.events.publish({ id, type: "order.deleted" });
  }
}

module.exports = { OrderService };
