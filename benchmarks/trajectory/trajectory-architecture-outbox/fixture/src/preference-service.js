/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const { validatePreferences } = require("./validation");

class PreferenceService {
  constructor({ accountRepository, db, outbox }) {
    this.accountRepository = accountRepository;
    this.db = db;
    this.outbox = outbox;
  }

  update(accountId, preferences) {
    const normalized = validatePreferences(preferences);
    return this.db.transaction((tx) => {
      const account = this.accountRepository.updatePreferences(
        tx,
        accountId,
        normalized
      );
      this.outbox.append(tx, {
        accountId,
        kind: "preferences.changed",
        payload: { preferences: account.preferences, version: account.version },
        sequence: account.version,
      });
      return account;
    });
  }
}

module.exports = { PreferenceService };
