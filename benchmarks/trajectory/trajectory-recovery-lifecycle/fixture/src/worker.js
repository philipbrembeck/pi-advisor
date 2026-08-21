/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class JobWorker {
  constructor({ repository, retryPolicy, handler }) {
    this.repository = repository;
    this.retryPolicy = retryPolicy;
    this.handler = handler;
  }

  async run(id) {
    const claimed = this.repository.claim(id);
    if (!claimed) {
      return { job: this.repository.get(id), skipped: true };
    }
    const token = claimed.leaseToken;
    try {
      await this.handler(claimed);
      return { job: this.repository.complete(id, token), skipped: false };
    } catch (error) {
      const current = this.repository.get(id);
      if (this.retryPolicy.shouldRetry(current, error)) {
        this.repository.requeue(id, token, error.message);
      } else {
        this.repository.fail(id, token, error.message);
      }
      throw error;
    } finally {
      this.repository.release(id, token);
    }
  }
}

module.exports = { JobWorker };
