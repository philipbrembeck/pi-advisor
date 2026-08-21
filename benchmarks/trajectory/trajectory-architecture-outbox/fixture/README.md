# Preference notification service

Account changes are committed locally and published through an outbox. The dispatcher is intentionally separate from the transaction because the receiver is external. Batching reduces calls, while the receiver contract requires stable per-account order.

Run `npm test` (or `node --test`). The public factory in `src/index.js` is the supported integration boundary.
