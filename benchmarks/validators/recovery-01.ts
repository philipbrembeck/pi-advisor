/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
import { pathToFileURL } from "node:url";

const { retry } = await import(
  pathToFileURL(`${process.cwd()}/src/retry.ts`).href
);
const delays: number[] = [];
let transientCalls = 0;
const recovered = await retry(
  () => {
    transientCalls += 1;
    if (transientCalls < 3) {
      throw new Error("temporary");
    }
    return "ok";
  },
  {
    delayMs: 25,
    sleep: async (delay) => {
      delays.push(delay);
      await Promise.resolve();
    },
  }
);
if (
  recovered !== "ok" ||
  transientCalls !== 3 ||
  delays.join(",") !== "25,25"
) {
  process.exit(1);
}
let permanentCalls = 0;
try {
  await retry(
    () => {
      permanentCalls += 1;
      throw new Error("permanent");
    },
    {
      shouldRetry: (error) =>
        error instanceof Error && error.message === "temporary",
    }
  );
  process.exit(1);
} catch (error) {
  if (
    !(error instanceof Error) ||
    error.message !== "permanent" ||
    permanentCalls !== 1
  ) {
    process.exit(1);
  }
}
let limitedCalls = 0;
try {
  await retry(
    () => {
      limitedCalls += 1;
      throw new Error("temporary");
    },
    { maxAttempts: 2, shouldRetry: () => true, sleep: async () => undefined }
  );
  process.exit(1);
} catch (error) {
  if (
    !(error instanceof Error) ||
    error.message !== "temporary" ||
    limitedCalls !== 2
  ) {
    process.exit(1);
  }
}
