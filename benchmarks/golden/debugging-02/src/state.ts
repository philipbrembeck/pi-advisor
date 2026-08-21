let state = "idle";
let transitions = 0;
export function reset() {
  state = "idle";
  transitions = 0;
}
export function start() {
  if (state === "idle") {
    state = "running";
    transitions += 1;
  }
}
export function finish() {
  if (state === "running") {
    state = "done";
    transitions += 1;
  }
}
export function current() {
  return state;
}
export function transitionCount() {
  return transitions;
}
