/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
export {};

const parser = await import(`${process.cwd()}/src/parser.ts`);
if (parser.parse("42") !== 42) {
  process.exit(1);
}
if (parser.parse("  -7_500 ") !== -7500) {
  process.exit(1);
}
if (parser.parse("+3.5") !== 3.5) {
  process.exit(1);
}
if (parser.parse("12px") !== undefined || parser.parse("1.2.3") !== undefined) {
  process.exit(1);
}
if (parser.parse("") !== undefined || parser.parse("   ") !== undefined) {
  process.exit(1);
}
