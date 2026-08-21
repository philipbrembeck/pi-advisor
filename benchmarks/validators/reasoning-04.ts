/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
const policy = await import(`${process.cwd()}/src/policy.ts`);
if (policy.cachePolicy(true, false, true, true) !== "cache") {
  process.exit(1);
}
if (policy.cachePolicy(false, true, true, false) !== "stale") {
  process.exit(1);
}
if (policy.cachePolicy(false, true, false, false) !== "network") {
  process.exit(1);
}
if (policy.cachePolicy(false, true, true, true) !== "error") {
  process.exit(1);
}
if (policy.cachePolicy(true, true, false, true) !== "cache") {
  process.exit(1);
}
