/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
import { pathToFileURL } from "node:url";

const { groupBy } = await import(
  pathToFileURL(`${process.cwd()}/src/helper.ts`).href
);
const values = [
  { id: 1, kind: "odd" },
  { id: 2, kind: "even" },
  { id: 3, kind: "odd" },
];
const grouped = groupBy(values, (value, index) => `${value.kind}-${index % 2}`);
if (
  JSON.stringify([...grouped]) !==
  JSON.stringify([
    ["odd-0", [values[0], values[2]]],
    ["even-1", [values[1]]],
  ])
) {
  process.exit(1);
}
if (
  grouped.get("odd-0")?.length !== 2 ||
  grouped.get("odd-0")?.[1] !== values[2]
) {
  process.exit(1);
}
const empty = groupBy([], () => "never");
if (empty.size !== 0) {
  process.exit(1);
}
