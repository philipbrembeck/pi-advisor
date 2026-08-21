/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

class TransactionError extends Error {
  constructor(message) {
    super(message);
    this.name = "TransactionError";
  }
}

module.exports = { TransactionError, ValidationError };
