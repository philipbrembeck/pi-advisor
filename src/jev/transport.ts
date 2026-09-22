import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { advisorJevTransportRef } from "../config/state.ts";
import { resolveTypeSafeKey } from "./key-store.ts";
import type { JevKeySource } from "./key-store.ts";

export type JevTransportKind = "typesafe" | "openrouter";

export interface JevCredentials {
  apiKey: string;
  /** Where the TypeSafe key came from; present on the typesafe transport. */
  source?: JevKeySource;
  transport: JevTransportKind;
}

export interface JevTransportDeps {
  /** Reads a pi-stored provider login; injectable for tests. */
  getProviderKey?: (provider: string) => Promise<string | undefined>;
  /** Resolves the TypeSafe key chain; injectable for tests. */
  resolveTypesafe?: () => ReturnType<typeof resolveTypeSafeKey>;
}

const OPENROUTER_PROVIDER = "openrouter";

const openRouterKey = async (
  ctx: ExtensionContext | undefined,
  deps: JevTransportDeps
): Promise<string | undefined> => {
  const key = deps.getProviderKey
    ? await deps.getProviderKey(OPENROUTER_PROVIDER)
    : await ctx?.modelRegistry?.getApiKeyForProvider(OPENROUTER_PROVIDER);
  return key?.trim() || undefined;
};

/** Resolves how Jev calls authenticate: a dedicated TypeSafe key first, then
 * the existing pi OpenRouter login (reuse per advisorJevTransport). */
export const resolveJevTransport = async (
  ctx?: ExtensionContext,
  deps: JevTransportDeps = {}
): Promise<JevCredentials | undefined> => {
  const preference = advisorJevTransportRef;
  if (preference !== "openrouter") {
    const resolveTypesafe = deps.resolveTypesafe ?? resolveTypeSafeKey;
    const resolution = await resolveTypesafe();
    if (resolution.key) {
      const credentials: JevCredentials = {
        apiKey: resolution.key,
        transport: "typesafe",
      };
      if (resolution.source) {
        credentials.source = resolution.source;
      }
      return credentials;
    }
  }
  if (preference === "typesafe") {
    return undefined;
  }
  const openrouter = await openRouterKey(ctx, deps);
  return openrouter
    ? { apiKey: openrouter, transport: "openrouter" }
    : undefined;
};
