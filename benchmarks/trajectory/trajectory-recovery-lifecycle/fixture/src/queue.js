/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class JobQueue {
  constructor(worker) {
    this.worker = worker;
  }

  async drain(ids) {
    const results = [];
    for (const id of ids) {
      try {
        results.push(await this.worker.run(id));
      } catch (error) {
        results.push({ error, job: this.worker.repository.get(id) });
      }
    }
    return results;
  }
}

module.exports = { JobQueue };
