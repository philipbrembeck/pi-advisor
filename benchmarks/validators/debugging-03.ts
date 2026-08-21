/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
import { pathToFileURL } from "node:url";

const state = await import(pathToFileURL(`${process.cwd()}/src/state.ts`).href);
const first: number[] = [];
const second: number[] = [];
const removeFirst = state.subscribe("count", (value: number) =>
  first.push(value)
);
state.set("count", 1);
const removeSecond = state.subscribe("count", (value: number) =>
  second.push(value)
);
state.set("count", 2);
removeFirst();
state.set("count", 3);
removeSecond();
state.set("count", 4);
if (JSON.stringify(first) !== JSON.stringify([1, 2])) {
  process.exit(1);
}
if (JSON.stringify(second) !== JSON.stringify([2, 3])) {
  process.exit(1);
}
if (state.get("count") !== 4) {
  process.exit(1);
}
