/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const { ValidationError } = require("./errors");

class AccountRepository {
  constructor(db) {
    this.db = db;
  }

  updatePreferences(tx, id, preferences) {
    const account = tx.accounts.get(id);
    if (!account) {
      throw new ValidationError(`unknown account ${id}`);
    }
    const next = {
      ...account,
      preferences: structuredClone(preferences),
      version: account.version + 1,
    };
    tx.accounts.set(id, next);
    return structuredClone(next);
  }

  get(id) {
    const account = this.db.accounts.get(id);
    return account ? structuredClone(account) : undefined;
  }
}

module.exports = { AccountRepository };
