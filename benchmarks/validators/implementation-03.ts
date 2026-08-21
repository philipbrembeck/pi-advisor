/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
import { pathToFileURL } from "node:url";

const { memoize } = await import(
  pathToFileURL(`${process.cwd()}/src/helper.ts`).href
);
let calls = 0;
const cached = memoize((left: number, right: number) => {
  calls += 1;
  return left + right;
});
if (cached(2, 3) !== 5 || cached(2, 3) !== 5 || calls !== 1) {
  process.exit(1);
}
if (cached(3, 2) !== 5 || calls !== 2) {
  process.exit(1);
}
let limitedCalls = 0;
const limited = memoize(
  (value: string) => {
    limitedCalls += 1;
    return value.toUpperCase();
  },
  { maxEntries: 2 }
);
limited("a");
limited("b");
limited("a");
limited("c");
limited("b");
if (limitedCalls !== 4) {
  process.exit(1);
}
