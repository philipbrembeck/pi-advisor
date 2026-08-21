import { next, requeue } from "./queue.ts";
import {
  attemptCount,
  isCompleted,
  markCompleted,
  recordAttempt,
} from "./store.ts";
import type { Job, JobResult } from "./types.ts";

export async function processNext(
  run: (job: Job) => Promise<string>
): Promise<JobResult | undefined> {
  const job = next();
  if (!job) {
    return undefined;
  }
  if (isCompleted(job.id)) {
    return { attempts: attemptCount(job.id), id: job.id, status: "duplicate" };
  }
  recordAttempt(job.id);
  try {
    const value = await run(job);
    markCompleted(job.id);
    return {
      attempts: attemptCount(job.id),
      id: job.id,
      status: "completed",
      value,
    };
  } catch (error) {
    requeue(job);
    throw error;
  }
}
