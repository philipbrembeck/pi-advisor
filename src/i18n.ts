/**
 * i18n bridge for pi-advisor.
 *
 * The SDK (@juicesharp/rpiv-i18n) is an optional peer: when absent, every
 * t(key, fallback) returns the fallback verbatim and the extension stays
 * English-only. Top-level await is required because t is consumed
 * synchronously by downstream modules.
 */

const I18N_NAMESPACE = "pi-advisor-flow";

type ScopeFn = (key: string, fallback: string) => string;

interface I18nSDK { scope: (namespace: string) => ScopeFn }

let scopeImpl: ScopeFn;

try {
  // SAFETY: the optional-peer contract pins scope(namespace) to the synchronous lookup; a mismatching module rejects the import below.
  const sdk = (await import("@juicesharp/rpiv-i18n")) as I18nSDK;
  scopeImpl = sdk.scope(I18N_NAMESPACE);
} catch {
  // SDK not installed — every t(key, fallback) returns the fallback verbatim.
  scopeImpl = (_key, fallback) => fallback;
}

export { I18N_NAMESPACE };

export const t: ScopeFn = scopeImpl;
