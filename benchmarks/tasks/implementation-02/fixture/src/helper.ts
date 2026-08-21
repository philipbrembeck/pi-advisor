export type Step<T> = (value: T) => T;

export function compose<T>(_steps: readonly Step<T>[]): Step<T> {
  throw new Error("not implemented");
}
