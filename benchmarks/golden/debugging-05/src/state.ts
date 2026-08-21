let state = "idle";
let lastError: string | undefined;
export function reset() {
  state = "idle";
  lastError = undefined;
}
export function start() {
  if (state === "idle") {
    state = "running";
  }
}
export function finish() {
  if (state === "running") {
    state = "done";
  }
}
export function fail(message: string) {
  lastError = message;
  state = "error";
}
export function current() {
  return state;
}
export function error() {
  return lastError;
}
