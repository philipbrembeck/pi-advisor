/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class RetryPolicy {
  constructor(maxAttempts = 3) {
    this.maxAttempts = maxAttempts;
  }

  shouldRetry(job, error) {
    return Boolean(error?.retryable) && job.attempts < this.maxAttempts;
  }
}

module.exports = { RetryPolicy };
