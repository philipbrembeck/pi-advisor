export type Step<T> = (value: T) => T;
export function compose<T>(steps: readonly Step<T>[]): Step<T> {
  return (value) => steps.reduce((current, step) => step(current), value);
}
