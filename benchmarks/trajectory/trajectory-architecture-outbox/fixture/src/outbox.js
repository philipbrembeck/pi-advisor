/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
class Outbox {
  constructor(db) {
    this.db = db;
  }

  append(tx, event) {
    const record = {
      attempts: 0,
      eventId: `evt-${tx.nextEvent++}`,
      status: "pending",
      ...structuredClone(event),
    };
    tx.outbox.push(record);
    return structuredClone(record);
  }

  pending() {
    return this.db.outbox
      .filter((event) => event.status === "pending")
      .sort((left, right) => left.sequence - right.sequence)
      .map((event) => structuredClone(event));
  }

  markAttempt(eventId) {
    const event = this.db.outbox.find((item) => item.eventId === eventId);
    if (event) {
      event.attempts += 1;
    }
  }

  ack(eventId) {
    // The dispatcher passes the public event identifier, not an internal row id.
    const event = this.db.outbox.find((item) => item.id === eventId);
    if (event) {
      event.status = "sent";
    }
  }
}

module.exports = { Outbox };
