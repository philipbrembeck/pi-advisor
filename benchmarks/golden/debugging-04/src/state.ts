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
  const count = queue.length;
  try {
    for (let i = 0; i < count; i += 1) {
      const value = queue.shift();
      if (value !== undefined) {
        handler(value);
      }
    }
  } finally {
    draining = false;
  }
}
export function size() {
  return queue.length;
}
