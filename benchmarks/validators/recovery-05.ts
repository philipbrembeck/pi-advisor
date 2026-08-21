/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
export {};

const parser = await import(`${process.cwd()}/src/parser.ts`);
const items = parser.parseItems("cpu=4\nmem=8\nbad\nmem=nope\ndisk=2");
if (
  JSON.stringify(items) !==
  JSON.stringify([
    { name: "cpu", value: 4 },
    { name: "mem", value: 8 },
    { name: "disk", value: 2 },
  ])
) {
  process.exit(1);
}
const repaired = parser.parseItems("x=1\nx=2\n=3\n y = 4 ");
if (
  JSON.stringify(repaired) !==
  JSON.stringify([
    { name: "x", value: 2 },
    { name: "y", value: 4 },
  ])
) {
  process.exit(1);
}
