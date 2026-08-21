/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
import { pathToFileURL } from "node:url";

const cache = await import(pathToFileURL(`${process.cwd()}/src/cache.ts`).href);
cache.setValue("role", "admin");
cache.setValue("region", "eu");
if (cache.getValue("role") !== "admin" || cache.getValue("region") !== "eu") {
  process.exit(1);
}
cache.invalidate("role");
if (cache.getValue("role") !== undefined || cache.getValue("region") !== "eu") {
  process.exit(1);
}
cache.setValue("role", "viewer");
if (cache.getValue("role") !== "viewer") {
  process.exit(1);
}
cache.invalidate("missing");
if (
  cache.getValue("region") !== "eu" ||
  cache.getValue("missing") !== undefined
) {
  process.exit(1);
}
cache.setValue("role", "owner");
cache.invalidate("role");
cache.setValue("role", "auditor");
if (cache.getValue("role") !== "auditor") {
  process.exit(1);
}
