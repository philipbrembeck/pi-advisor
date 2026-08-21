/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
"use strict";
function createRequestHandler(service) {
  return {
    async deleteOrder(request) {
      await service.remove(request.params.id);
      return { status: 204 };
    },
    async getOrder(request) {
      return service.get(request.params.id);
    },
    async patchOrder(request) {
      return service.update(request.params.id, request.body);
    },
  };
}

module.exports = { createRequestHandler };
