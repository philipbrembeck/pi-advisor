/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const { NotFoundError } = require("./errors");

class OrderRepository {
  constructor(seed = []) {
    this.orders = new Map(
      seed.map((order) => [order.id, structuredClone(order)])
    );
    this.readCount = 0;
    this.writeCount = 0;
  }

  async findById(id) {
    this.readCount += 1;
    const order = this.orders.get(id);
    if (!order) {
      throw new NotFoundError(id);
    }
    return structuredClone(order);
  }

  async update(id, patch) {
    const current = this.orders.get(id);
    if (!current) {
      throw new NotFoundError(id);
    }
    const next = { ...current, ...structuredClone(patch), id: current.id };
    this.orders.set(id, next);
    this.writeCount += 1;
    return structuredClone(next);
  }

  async remove(id) {
    if (!this.orders.delete(id)) {
      throw new NotFoundError(id);
    }
    this.writeCount += 1;
  }
}

module.exports = { OrderRepository };
