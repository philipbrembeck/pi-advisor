/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
const policy = await import(`${process.cwd()}/src/policy.ts`);
if (policy.choose(2, true) !== "cached") {
  process.exit(1);
}
if (policy.choose(2, false) !== "v2") {
  process.exit(1);
}
if (policy.choose(1, false) !== "legacy") {
  process.exit(1);
}
if (policy.choose(1, true) !== "cached") {
  process.exit(1);
}
