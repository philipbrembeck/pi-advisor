/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
const policy = await import(`${process.cwd()}/src/policy.ts`);
if (policy.selectTransport(true, true, true, true) !== "offline") {
  process.exit(1);
}
if (policy.selectTransport(false, true, true, true) !== "websocket") {
  process.exit(1);
}
if (policy.selectTransport(false, true, true, false) !== "http2") {
  process.exit(1);
}
if (policy.selectTransport(false, false, true, true) !== "http2") {
  process.exit(1);
}
if (policy.selectTransport(false, false, false, false) !== "http1") {
  process.exit(1);
}
