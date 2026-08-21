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
  // bug: retries receive a new identity and bypass idempotency checks
  pending.push({ ...job, id: `${job.id}:retry` });
}
export function size() {
  return pending.length;
}
