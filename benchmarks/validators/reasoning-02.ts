/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
const policy = await import(`${process.cwd()}/src/policy.ts`);
if (!policy.canUseFeature("admin", false, 0, 99)) {
  process.exit(1);
}
if (!policy.canUseFeature("member", true, 50, 10)) {
  process.exit(1);
}
if (policy.canUseFeature("member", true, 50, 50)) {
  process.exit(1);
}
if (policy.canUseFeature("guest", true, 100, 0)) {
  process.exit(1);
}
if (policy.canUseFeature("member", true, -1, 0)) {
  process.exit(1);
}
if (!policy.canUseFeature("member", true, 100, 99)) {
  process.exit(1);
}
