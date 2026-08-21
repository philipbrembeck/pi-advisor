/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class WebhookClient {
  constructor() {
    this.calls = [];
    this.failAfterAccept = false;
  }

  async send(accountId, events, options = {}) {
    this.calls.push({
      accountId,
      eventIds: events.map((event) => event.eventId),
      idempotencyKey: options.idempotencyKey,
    });
    if (this.failAfterAccept) {
      this.failAfterAccept = false;
      const error = new Error(
        "connection lost after receiver accepted request"
      );
      error.accepted = true;
      throw error;
    }
    return { accepted: true };
  }
}

module.exports = { WebhookClient };
