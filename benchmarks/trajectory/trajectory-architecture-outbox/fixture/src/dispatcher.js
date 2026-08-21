/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class Dispatcher {
  constructor({ client, deliveryLog, outbox }) {
    this.client = client;
    this.deliveryLog = deliveryLog;
    this.outbox = outbox;
  }

  async dispatch() {
    const pending = this.outbox.pending();
    const groups = new Map();
    for (const event of pending) {
      const events = groups.get(event.accountId) ?? [];
      events.push(event);
      groups.set(event.accountId, events);
    }
    for (const [accountId, events] of groups) {
      const key = events.map((event) => event.eventId).join(",");
      if (!this.deliveryLog.has(key)) {
        for (const event of events) {
          this.outbox.markAttempt(event.eventId);
        }
        await this.client.send(accountId, events, { idempotencyKey: key });
        this.deliveryLog.record(key);
      }
      for (const event of events) {
        this.outbox.ack(event.eventId);
      }
    }
  }
}

module.exports = { Dispatcher };
