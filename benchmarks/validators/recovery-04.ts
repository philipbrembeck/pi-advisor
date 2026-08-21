/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
export {};

const parser = await import(`${process.cwd()}/src/parser.ts`);
if (
  JSON.stringify(parser.parseList("a,b,c")) !== JSON.stringify(["a", "b", "c"])
) {
  process.exit(1);
}
if (
  JSON.stringify(parser.parseList('a,"b,c",d')) !==
  JSON.stringify(["a", "b,c", "d"])
) {
  process.exit(1);
}
if (
  JSON.stringify(parser.parseList('"say ""hi""",, tail ')) !==
  JSON.stringify(['say "hi"', "", " tail "])
) {
  process.exit(1);
}
if (
  JSON.stringify(parser.parseList('"unfinished')) !==
  JSON.stringify(["unfinished"])
) {
  process.exit(1);
}
