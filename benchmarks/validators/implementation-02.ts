/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
import { pathToFileURL } from "node:url";

const { compose } = await import(
  pathToFileURL(`${process.cwd()}/src/helper.ts`).href
);
const add = (n: number) => n + 2;
const double = (n: number) => n * 2;
const pipeline = compose([add, double]);
if (pipeline(3) !== 10 || compose<number>([])(9) !== 9) {
  process.exit(1);
}
const steps = [add, double] as const;
const result = compose(steps);
if (result(0) !== 4 || steps.length !== 2) {
  process.exit(1);
}
