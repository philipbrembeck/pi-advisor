/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
export {};

const state = await import(`${process.cwd()}/src/state.ts`);
state.reset();
state.finish();
if (state.current() !== "idle" || state.transitionCount() !== 0) {
  process.exit(1);
}
state.start();
state.start();
if (state.current() !== "running" || state.transitionCount() !== 1) {
  process.exit(1);
}
state.finish();
state.finish();
if (state.current() !== "done" || state.transitionCount() !== 2) {
  process.exit(1);
}
state.reset();
if (state.current() !== "idle" || state.transitionCount() !== 0) {
  process.exit(1);
}
