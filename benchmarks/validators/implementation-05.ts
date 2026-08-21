/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
import { pathToFileURL } from "node:url";

const { parseCsvLine } = await import(
  pathToFileURL(`${process.cwd()}/src/helper.ts`).href
);
if (JSON.stringify(parseCsvLine("a,b,c")) !== JSON.stringify(["a", "b", "c"])) {
  process.exit(1);
}
if (
  JSON.stringify(parseCsvLine('a,"b,c","say ""hi"""')) !==
  JSON.stringify(["a", "b,c", 'say "hi"'])
) {
  process.exit(1);
}
if (
  JSON.stringify(parseCsvLine('" leading ",,tail')) !==
  JSON.stringify([" leading ", "", "tail"])
) {
  process.exit(1);
}
if (
  JSON.stringify(parseCsvLine('"a\n b",z')) !== JSON.stringify(["a\n b", "z"])
) {
  process.exit(1);
}
