/* biome-ignore-all lint/performance/noAwaitInLoops: retry attempts are intentionally sequential. */
/* biome-ignore-all lint/suspicious/noUnnecessaryConditions: the retry loop exits through return or throw. */
export interface RetryOptions {
  delayMs?: number;
  maxAttempts?: number;
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (delayMs: number) => Promise<void>;
}

export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const shouldRetry = options.shouldRetry ?? (() => true);
  const sleep =
    options.sleep ??
    (async (delayMs: number) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    });
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (attempt >= maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      if ((options.delayMs ?? 0) > 0) {
        await sleep(options.delayMs ?? 0);
      }
    }
  }
}
