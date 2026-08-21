import type { Job } from "./types.ts";

const pending: Job[] = [];
export function resetQueue() {
  pending.length = 0;
}
export function enqueue(job: Job) {
  pending.push({ ...job });
}
export function next(): Job | undefined {
  return pending.shift();
}
export function requeue(job: Job) {
  pending.unshift({ ...job });
}
export function size() {
  return pending.length;
}
