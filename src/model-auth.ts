export const hasUsableModelAuth = (auth: {
  apiKey?: string;
  headers?: Record<string, string | null>;
}) =>
  Boolean(auth.apiKey?.trim()) ||
  Object.values(auth.headers ?? {}).some((value) => Boolean(value?.trim()));
