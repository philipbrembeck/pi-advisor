/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const { TransactionError } = require("./errors");

class Database {
  constructor(accounts = []) {
    this.accounts = new Map(
      accounts.map((account) => [account.id, structuredClone(account)])
    );
    this.outbox = [];
    this.nextEvent = 1;
  }

  transaction(callback) {
    const snapshot = {
      accounts: structuredClone(this.accounts),
      nextEvent: this.nextEvent,
      outbox: structuredClone(this.outbox),
    };
    const tx = {
      accounts: structuredClone(this.accounts),
      nextEvent: this.nextEvent,
      outbox: structuredClone(this.outbox),
    };
    try {
      const value = callback(tx);
      this.accounts = tx.accounts;
      this.outbox = tx.outbox;
      this.nextEvent = tx.nextEvent;
      return value;
    } catch (error) {
      this.accounts = snapshot.accounts;
      this.outbox = snapshot.outbox;
      this.nextEvent = snapshot.nextEvent;
      throw new TransactionError(error.message);
    }
  }
}

module.exports = { Database };
