/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
export {};

const state = await import(`${process.cwd()}/src/state.ts`);
state.reset();
state.start();
state.finish();
if (state.current() !== "done" || state.error() !== undefined) {
  process.exit(1);
}
state.reset();
state.start();
state.fail("network");
if (state.current() !== "error" || state.error() !== "network") {
  process.exit(1);
}
state.reset();
state.fail("bad");
state.finish();
if (state.current() !== "error" || state.error() !== "bad") {
  process.exit(1);
}
