/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
const { OrderCache } = require("./cache");
const { EventBus } = require("./event-bus");
const { OrderRepository } = require("./repository");
const { OrderService } = require("./order-service");
const { createRequestHandler } = require("./request-handler");

function createOrderApi(seed) {
  const events = new EventBus();
  const repository = new OrderRepository(seed);
  const cache = new OrderCache(events);
  const service = new OrderService({ cache, events, repository });
  return {
    cache,
    events,
    handler: createRequestHandler(service),
    repository,
    service,
  };
}

module.exports = { createOrderApi };
