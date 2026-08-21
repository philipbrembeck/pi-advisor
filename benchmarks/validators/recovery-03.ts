/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
export {};

const parser = await import(`${process.cwd()}/src/parser.ts`);
const config = parser.parseConfig(
  "retries=3\nmode=fast\nenabled=true\n# comment\nunknown=ignored"
);
if (config.enabled !== true || config.mode !== "fast" || config.retries !== 3) {
  process.exit(1);
}
const quoted = parser.parseConfig('mode="safe mode"\nenabled=false\nretries=0');
if (
  quoted.mode !== "safe mode" ||
  quoted.enabled !== false ||
  quoted.retries !== 0
) {
  process.exit(1);
}
const recovered = parser.parseConfig("retries=nope\n=bad\nmode=\nretries=4");
if (recovered.retries !== 4 || recovered.mode !== "") {
  process.exit(1);
}
