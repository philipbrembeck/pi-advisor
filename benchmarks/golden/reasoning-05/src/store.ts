const completed = new Set<string>();
const attempts = new Map<string, number>();

export function resetStore() {
  completed.clear();
  attempts.clear();
}
export function isCompleted(id: string) {
  return completed.has(id);
}
export function recordAttempt(id: string) {
  attempts.set(id, (attempts.get(id) ?? 0) + 1);
}
export function attemptCount(id: string) {
  return attempts.get(id) ?? 0;
}
export function markCompleted(id: string) {
  completed.add(id);
}
