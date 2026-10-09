import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  advisorJevBaseUrlRef,
  advisorJevKeyProviderRef,
  advisorJevTransportRef,
} from "../config/state.ts";
import { normalizeJevBaseUrl } from "./base-url.ts";
import { resolveJevEndpointKey } from "./endpoint-key-store.ts";
import type { JevEndpointKeyResolution } from "./endpoint-key-store.ts";
import { resolveTypeSafeKey } from "./key-store.ts";
import type { JevKeySource } from "./key-store.ts";
import { resolveOpenAIDecisionsKey } from "./openai-key-store.ts";
import type { OpenAIDecisionsKeyResolution } from "./openai-key-store.ts";

export type JevTransportKind =
  | "typesafe"
  | "openrouter"
  | "openai-decisions"
  | "typesafe-compatible";

export type JevCredentialSource =
  | JevKeySource
  | "openai-env"
  | "openai-provider-credential"
  | "openai-bun-secrets"
  | "openai-file"
  | JevEndpointKeyResolution["source"]
  | "provider-credential";

export interface JevCredentials {
  apiKey: string;
  baseUrl?: string;
  source?: JevCredentialSource;
  transport: JevTransportKind;
}

export interface JevEndpointTarget {
  baseUrl: string;
  keyProvider?: string;
}

export interface JevProviderAuthResult {
  auth: { apiKey?: string };
  source?: string;
}

export interface JevTransportDeps {
  /** Reads a pi-stored provider login; injectable for tests. */
  getProviderKey?: (provider: string) => Promise<string | undefined>;
  /** Resolves Pi provider auth with its source label; injectable for tests. */
  getProviderAuth?: (
    provider: string
  ) => Promise<JevProviderAuthResult | undefined>;
  /** Resolves the extension-owned OpenAI Decisions key; injectable for tests. */
  resolveOpenAIKey?: () => Promise<OpenAIDecisionsKeyResolution>;
  /** Resolves the extension-owned endpoint key; injectable for tests. */
  resolveEndpointKey?: () => Promise<JevEndpointKeyResolution>;
  /** Resolves the TypeSafe key chain; injectable for tests. */
  resolveTypesafe?: () => ReturnType<typeof resolveTypeSafeKey>;
}

const OPENROUTER_PROVIDER = "openrouter";
const OPENAI_PROVIDER = "openai";
const OPENAI_API_KEY_SOURCES = new Map<string, JevCredentialSource>([
  ["OPENAI_API_KEY", "openai-env"],
  ["stored credential", "openai-provider-credential"],
]);

const openAiPlatformCredentials = async (
  ctx: ExtensionContext | undefined,
  deps: JevTransportDeps
): Promise<JevCredentials | undefined> => {
  let result: JevProviderAuthResult | undefined;
  try {
    result = deps.getProviderAuth
      ? await deps.getProviderAuth(OPENAI_PROVIDER)
      : await ctx?.modelRegistry?.getProviderAuth(OPENAI_PROVIDER);
  } catch {
    result = undefined;
  }
  const source = result?.source;
  const credentialSource = source
    ? OPENAI_API_KEY_SOURCES.get(source)
    : undefined;
  const apiKey = result?.auth.apiKey?.trim();
  if (credentialSource && apiKey) {
    return {
      apiKey,
      source: credentialSource,
      transport: "openai-decisions",
    };
  }
  try {
    const stored = await (deps.resolveOpenAIKey ?? resolveOpenAIDecisionsKey)();
    const storedKey = stored.key?.trim();
    return storedKey && stored.source
      ? {
          apiKey: storedKey,
          source: stored.source,
          transport: "openai-decisions",
        }
      : undefined;
  } catch {
    return undefined;
  }
};

const openRouterKey = async (
  ctx: ExtensionContext | undefined,
  deps: JevTransportDeps
): Promise<string | undefined> => {
  const key = deps.getProviderKey
    ? await deps.getProviderKey(OPENROUTER_PROVIDER)
    : await ctx?.modelRegistry?.getApiKeyForProvider(OPENROUTER_PROVIDER);
  return key?.trim() || undefined;
};

const typeSafeCredentials = async (
  deps: JevTransportDeps
): Promise<JevCredentials | undefined> => {
  const resolution = await (deps.resolveTypesafe ?? resolveTypeSafeKey)();
  if (!resolution.key) {
    return undefined;
  }
  const credentials: JevCredentials = {
    apiKey: resolution.key,
    transport: "typesafe",
  };
  if (resolution.source) {
    credentials.source = resolution.source;
  }
  return credentials;
};

export const resolveTypesafeCompatibleCredentials = async (
  target: JevEndpointTarget,
  ctx?: ExtensionContext,
  deps: JevTransportDeps = {}
): Promise<JevCredentials | undefined> => {
  const { baseUrl } = target;
  const provider = target.keyProvider;
  if (provider) {
    let providerKey: string | undefined;
    try {
      providerKey = deps.getProviderKey
        ? await deps.getProviderKey(provider)
        : await ctx?.modelRegistry?.getApiKeyForProvider(provider);
    } catch {
      providerKey = undefined;
    }
    const trimmed = providerKey?.trim();
    if (!trimmed) {
      // A declared Pi login wins outright; a stale store key must never stand in.
      return undefined;
    }
    return {
      apiKey: trimmed,
      baseUrl,
      source: "provider-credential",
      transport: "typesafe-compatible",
    };
  }
  const resolution = await (deps.resolveEndpointKey ?? resolveJevEndpointKey)();
  if (!resolution.key) {
    return undefined;
  }
  const credentials: JevCredentials = {
    apiKey: resolution.key,
    baseUrl,
    transport: "typesafe-compatible",
  };
  if (resolution.source) {
    credentials.source = resolution.source;
  }
  return credentials;
};

const typeSafeCompatibleCredentials = (
  ctx: ExtensionContext | undefined,
  deps: JevTransportDeps
): Promise<JevCredentials | undefined> => {
  const configured = advisorJevBaseUrlRef;
  if (!configured) {
    return Promise.resolve(undefined);
  }
  const { baseUrl } = normalizeJevBaseUrl(configured);
  if (!baseUrl) {
    return Promise.resolve(undefined);
  }
  const options = advisorJevKeyProviderRef
    ? { baseUrl, keyProvider: advisorJevKeyProviderRef }
    : { baseUrl };
  return resolveTypesafeCompatibleCredentials(options, ctx, deps);
};

export const resolveJevTransportFor = async (
  transport: JevTransportKind,
  ctx?: ExtensionContext,
  deps: JevTransportDeps = {}
): Promise<JevCredentials | undefined> => {
  if (transport === "typesafe") {
    return typeSafeCredentials(deps);
  }
  if (transport === "typesafe-compatible") {
    return typeSafeCompatibleCredentials(ctx, deps);
  }
  if (transport === "openrouter") {
    const key = await openRouterKey(ctx, deps);
    return key ? { apiKey: key, transport } : undefined;
  }
  return openAiPlatformCredentials(ctx, deps);
};

/** Resolves `auto` as TypeSafe then OpenRouter; explicit choices never fall back. */
export const resolveJevTransport = async (
  ctx?: ExtensionContext,
  deps: JevTransportDeps = {}
): Promise<JevCredentials | undefined> => {
  const preference = advisorJevTransportRef;
  if (preference !== "auto") {
    return resolveJevTransportFor(preference, ctx, deps);
  }
  const typesafe = await typeSafeCredentials(deps);
  return typesafe ?? resolveJevTransportFor("openrouter", ctx, deps);
};
