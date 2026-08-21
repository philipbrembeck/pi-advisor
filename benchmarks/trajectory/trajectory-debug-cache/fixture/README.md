# Order service

This small service models the read and update path used by the HTTP adapter. The cache is intentionally part of the latency contract: updates should make the next read coherent without turning every read into a repository call.

Run `npm test` (or `node --test`) before and after changes.
