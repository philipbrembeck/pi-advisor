/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class LeaseLostError extends Error {
  constructor(id) {
    super(`lease lost for ${id}`);
    this.name = "LeaseLostError";
  }
}

class UnknownJobError extends Error {
  constructor(id) {
    super(`unknown job ${id}`);
    this.name = "UnknownJobError";
  }
}

module.exports = { LeaseLostError, UnknownJobError };
