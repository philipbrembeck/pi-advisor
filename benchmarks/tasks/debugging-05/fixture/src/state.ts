let state = "idle";
let lastError: string | undefined;
export function reset() {
  state = "idle";
  lastError = undefined;
}
export function start() {
  state = "running";
}
export function finish() {
  state = "idle";
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
