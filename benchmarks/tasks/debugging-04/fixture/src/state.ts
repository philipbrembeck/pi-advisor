const queue: string[] = [];
let draining = false;
export function enqueue(value: string) {
  queue.push(value);
}
export function drain(handler: (value: string) => void) {
  if (draining) {
    return;
  }
  draining = true;
  for (const value of queue) {
    handler(value);
    queue.shift();
  }
  draining = false;
}
export function size() {
  return queue.length;
}
