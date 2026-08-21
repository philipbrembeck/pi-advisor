/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const { AccountRepository } = require("./account-repository");
const { Database } = require("./database");
const { DeliveryLog } = require("./delivery-log");
const { Dispatcher } = require("./dispatcher");
const { Outbox } = require("./outbox");
const { PreferenceService } = require("./preference-service");
const { WebhookClient } = require("./webhook-client");

function createService(accounts) {
  const db = new Database(accounts);
  const outbox = new Outbox(db);
  const accountRepository = new AccountRepository(db);
  const service = new PreferenceService({ accountRepository, db, outbox });
  const client = new WebhookClient();
  const deliveryLog = new DeliveryLog();
  const dispatcher = new Dispatcher({ client, deliveryLog, outbox });
  return {
    accountRepository,
    client,
    db,
    deliveryLog,
    dispatcher,
    outbox,
    service,
  };
}

module.exports = { createService };
