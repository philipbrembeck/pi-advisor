/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
import { pathToFileURL } from "node:url";

const fail = (caseName: string): never => {
  process.stderr.write(`implementation-01 failed: ${caseName}\n`);
  process.exit(1);
};
const { DEFAULT_SETTINGS, mergeSettings } = await import(
  pathToFileURL(`${process.cwd()}/src/index.ts`).href
);
const base = {
  headers: { "X-Base": "yes" },
  retries: 0,
  tags: ["base", "shared"],
  timeoutMs: 1000,
};
const override = {
  headers: { "X-Base": "replaced", "X-Override": "yes" },
  tags: ["shared", "new"],
  timeoutMs: 0,
};
const merged = mergeSettings(base, override);
const expected = {
  headers: { "X-Base": "replaced", "X-Override": "yes" },
  retries: 0,
  tags: ["base", "shared", "new"],
  timeoutMs: 0,
};
if (JSON.stringify(merged) !== JSON.stringify(expected)) {
  fail("nested merge and explicit zero");
}
if (base.headers["X-Base"] !== "yes" || base.tags.join(",") !== "base,shared") {
  fail("input immutability");
}
const defaults = mergeSettings(DEFAULT_SETTINGS, {
  headers: { Accept: "json" },
});
if (
  defaults.timeoutMs !== 5000 ||
  defaults.retries !== 2 ||
  defaults.headers.Accept !== "json" ||
  defaults.tags.length !== 0
) {
  fail("defaults and omitted fields");
}
const second = mergeSettings(merged, { headers: {}, tags: [] });
if (second.tags.length !== 0 || second.headers["X-Base"] !== "replaced") {
  fail("explicit tag reset");
}
