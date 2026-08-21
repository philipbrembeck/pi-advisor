# Job runner

The runner is used by a process that may be stopped between a handler's side effect and its acknowledgement. `JobRunner` is the public entry point. The in-memory store stands in for durable state and deliberately exposes snapshots for tests.

Run `npm test` (or `node --test`).
