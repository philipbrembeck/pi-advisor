/* biome-ignore-all lint: benchmark fixture/validator intentionally models a realistic defect surface. */
/* biome-ignore-all assist: benchmark fixture/validator intentionally models a realistic defect surface. */
import { pathToFileURL } from "node:url";

const queue = await import(pathToFileURL(`${process.cwd()}/src/state.ts`).href);
queue.enqueue("a");
queue.enqueue("b");
queue.enqueue("c");
const seen: string[] = [];
queue.drain((value: string) => seen.push(value));
if (seen.join(",") !== "a,b,c" || queue.size() !== 0) {
  process.exit(1);
}
queue.enqueue("d");
queue.drain((value: string) => {
  seen.push(value);
  if (value === "d") {
    queue.enqueue("e");
  }
});
if (seen.join(",") !== "a,b,c,d" || queue.size() !== 1) {
  process.exit(1);
}
queue.drain((value: string) => seen.push(value));
if (seen.join(",") !== "a,b,c,d,e" || queue.size() !== 0) {
  process.exit(1);
}
