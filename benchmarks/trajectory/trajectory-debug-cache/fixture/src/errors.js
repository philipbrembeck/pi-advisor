/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class NotFoundError extends Error {
  constructor(id) {
    super(`order ${id} was not found`);
    this.name = "NotFoundError";
    this.code = "ORDER_NOT_FOUND";
  }
}

class InvalidOrderError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidOrderError";
    this.code = "INVALID_ORDER";
  }
}

module.exports = { InvalidOrderError, NotFoundError };
