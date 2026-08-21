export interface RetryOptions {
  delayMs?: number;
  maxAttempts?: number;
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (delayMs: number) => Promise<void>;
}

export async function retry<T>(
  _operation: () => Promise<T>,
  _options: RetryOptions = {}
): Promise<T> {
  await Promise.resolve();
  throw new Error("interrupted");
}
