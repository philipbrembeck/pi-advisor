import type { Theme } from "@earendil-works/pi-coding-agent";
import { noul } from "@typesafe-ai/sdk";

import type { JevTransport } from "../config/types.ts";
import { jevClientFromCredentials } from "../jev/client.ts";
import { OPENAI_DECISIONS_MODEL } from "../jev/decisions-client.ts";
import {
  clearJevEndpointKey,
  writeJevEndpointKey,
} from "../jev/endpoint-key-store.ts";
import {
  clearKeyTypeSafeKey,
  removeTypeSafeKeyFromAdvisorJson,
  writeKeyTypeSafeKey,
} from "../jev/key-store.ts";
import {
  clearOpenAIDecisionsKey,
  writeOpenAIDecisionsKey,
} from "../jev/openai-key-store.ts";
import {
  resolveJevTransport,
  resolveJevTransportFor,
  resolveTypesafeCompatibleCredentials,
} from "../jev/transport.ts";
import type { JevCredentials, JevTransportKind } from "../jev/transport.ts";
import { redactSecrets } from "../redaction.ts";
import type {
  JevProviderSelection,
  JevSetupDeps,
  RenderRequester,
} from "./types.ts";

export type JevProviderMode =
  | "menu"
  | "base-url"
  | "provider-id"
  | "resolving"
  | "verifying"
  | "clearing"
  | "key-entry";

export type JevProviderAction =
  | JevTransportKind
  | "clear-stored-key"
  | "done"
  | "enter-key"
  | "reuse-provider-login";

export interface JevProviderSubmenuOptions {
  afterSelection?: () => void;
  currentBaseUrl?: string;
  currentKeyProvider?: string;
  currentTransport: JevTransport;
  currentValue: string;
  done: (selectedValue?: string) => void;
  onSelection?: (selection: JevProviderSelection) => boolean;
  setupDeps?: JevSetupDeps;
  theme: Theme;
  tui: RenderRequester;
}

export interface JevProviderViewState {
  baseUrl?: string;
  canEnterKey: boolean;
  canReuseProviderLogin: boolean;
  credentials: JevCredentials | undefined;
  inputError: string | undefined;
  mode: JevProviderMode;
  notice: string | undefined;
  providerId?: string;
  selectedIndex: number;
  selectedTransport: JevTransportKind | undefined;
}

export const fireAndForget = async (
  action: Promise<unknown>,
  onError: (message: string) => void
): Promise<void> => {
  try {
    await action;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onError(redactSecrets(message));
  }
};

export const providerName = (transport: JevTransportKind): string => {
  if (transport === "typesafe") {
    return "TypeSafe Jev";
  }
  if (transport === "openrouter") {
    return "OpenRouter (Pi login)";
  }
  if (transport === "typesafe-compatible") {
    return "System One–compatible endpoint";
  }
  return `OpenAI Decisions (${OPENAI_DECISIONS_MODEL})`;
};

const endpointSourceLabel = (source: JevCredentials["source"]): string => {
  switch (source) {
    case "provider-credential": {
      return "Pi provider login";
    }
    case "jev-bun-secrets": {
      return "Bun.secrets";
    }
    case "jev-file": {
      return "stored file, mode 0600";
    }
    default: {
      return "JEV_API_KEY";
    }
  }
};

export const transportLabel = (credentials: JevCredentials): string => {
  if (credentials.transport === "openrouter") {
    return "OpenRouter (reusing Pi login)";
  }
  if (credentials.transport === "typesafe-compatible") {
    return `System One–compatible (${credentials.baseUrl ?? "no Base URL"}; key: ${endpointSourceLabel(credentials.source)})`;
  }
  if (credentials.transport === "openai-decisions") {
    let source = "verified API key";
    switch (credentials.source) {
      case "openai-bun-secrets": {
        source = "Bun.secrets";
        break;
      }
      case "openai-env": {
        source = "OPENAI_API_KEY";
        break;
      }
      case "openai-file": {
        source = "stored file, mode 0600";
        break;
      }
      case "openai-provider-credential": {
        source = "Pi stored API key";
        break;
      }
      default: {
        break;
      }
    }
    return `OpenAI Decisions (${OPENAI_DECISIONS_MODEL}; key: ${source})`;
  }
  switch (credentials.source) {
    case "advisor-json": {
      return "TypeSafe (key: advisor.json — plaintext, not recommended)";
    }
    case "bun-secrets": {
      return "TypeSafe (key: Bun.secrets)";
    }
    case "file": {
      return "TypeSafe (key: stored file, mode 0600)";
    }
    default: {
      return "TypeSafe (key: TYPESAFE_API_KEY)";
    }
  }
};

export const canClearCredential = (credentials: JevCredentials) =>
  credentials.source === "bun-secrets" ||
  credentials.source === "file" ||
  credentials.source === "openai-bun-secrets" ||
  credentials.source === "openai-file" ||
  credentials.source === "jev-bun-secrets" ||
  credentials.source === "jev-file";

export const canReplaceWithEnteredKey = (credentials: JevCredentials) =>
  credentials.transport === "typesafe" ||
  credentials.transport === "typesafe-compatible" ||
  (credentials.transport === "openai-decisions" &&
    (credentials.source === "openai-bun-secrets" ||
      credentials.source === "openai-file"));

export const keyEntryPrompt = (transport: JevTransportKind): string => {
  if (transport === "openai-decisions") {
    return "Paste an OpenAI Platform API key";
  }
  if (transport === "typesafe-compatible") {
    return "Paste the endpoint API key";
  }
  return "Paste a TypeSafe API key";
};

export const defaultVerify = async (credentials: JevCredentials) => {
  const client = jevClientFromCredentials(credentials);
  try {
    await client.ask(
      { purpose: "pi-advisor setup verification" },
      { verified: noul("Answer yes.") }
    );
    return { ok: true };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
};

const writeKeyFor = (key: string, transport: JevTransportKind) => {
  if (transport === "openai-decisions") {
    return writeOpenAIDecisionsKey(key);
  }
  if (transport === "typesafe-compatible") {
    return writeJevEndpointKey(key);
  }
  return writeKeyTypeSafeKey(key);
};

const clearKeyFor = (transport: JevTransportKind) => {
  if (transport === "openai-decisions") {
    return clearOpenAIDecisionsKey();
  }
  if (transport === "typesafe-compatible") {
    return clearJevEndpointKey();
  }
  return clearKeyTypeSafeKey();
};

export const defaultSetupDeps: Required<JevSetupDeps> = {
  clearStoredKey: (transport) => clearKeyFor(transport),
  removePlaintextKey: removeTypeSafeKeyFromAdvisorJson,
  resolveEndpoint: (options) => resolveTypesafeCompatibleCredentials(options),
  resolveTransport: (transport) =>
    transport ? resolveJevTransportFor(transport) : resolveJevTransport(),
  verify: defaultVerify,
  writeKey: (key, transport) => writeKeyFor(key, transport),
};

export { consumePlaintextKeyWarning as consumeSetupPlaintextWarning } from "../jev/key-store.ts";
