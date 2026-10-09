import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { redactSecrets } from "../redaction.ts";
import type { JevKeyStoreResult, JevSecretsLike } from "./key-store.ts";

export const JEV_ENDPOINT_KEY_ENV_VAR = "JEV_API_KEY";
const JEV_ENDPOINT_KEY_SERVICE = "pi-advisor";
const JEV_ENDPOINT_KEY_NAME = "jev-api-key";

const KEY_FILE_MODE = 0o600;

type JevEndpointKeySource = "jev-bun-secrets" | "jev-env" | "jev-file";

export interface JevEndpointKeyResolution {
  key?: string;
  source?: JevEndpointKeySource;
}

export interface JevEndpointKeyStoreDeps {
  deleteFileStore?: () => void;
  env?: NodeJS.ProcessEnv;
  readFileStore?: () => string | undefined;
  secrets?: JevSecretsLike | null;
  writeFileStore?: (key: string) => void;
}

interface BunGlobal {
  Bun?: { secrets?: JevSecretsLike };
}

const runtimeSecrets = (): JevSecretsLike | undefined => {
  // SAFETY: only Bun runtimes expose Bun.secrets; other hosts leave it absent.
  const bun = globalThis as BunGlobal;
  return bun.Bun?.secrets;
};

const keyFilePath = () => join(getAgentDir(), "jev_api_key");

const normalizeKey = (value: string | null | undefined) =>
  value?.trim() || undefined;

const readDefaultFileStore = (): string | undefined => {
  try {
    return normalizeKey(readFileSync(keyFilePath(), "utf-8"));
  } catch {
    return undefined;
  }
};

const writeDefaultFileStore = (key: string) => {
  const path = keyFilePath();
  writeFileSync(path, `${key}\n`, { mode: KEY_FILE_MODE });
  chmodSync(path, KEY_FILE_MODE);
};

const deleteDefaultFileStore = () => rmSync(keyFilePath(), { force: true });

const messageOf = <Error>(error: Error) =>
  redactSecrets(error instanceof Error ? error.message : String(error));

/** Resolves the endpoint key: Bun.secrets → JEV_API_KEY → the 0600 key file. */
export const resolveJevEndpointKey = async (
  deps: JevEndpointKeyStoreDeps = {}
): Promise<JevEndpointKeyResolution> => {
  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;
  if (secrets) {
    try {
      const stored = normalizeKey(
        await secrets.get({
          name: JEV_ENDPOINT_KEY_NAME,
          service: JEV_ENDPOINT_KEY_SERVICE,
        })
      );
      if (stored) {
        return { key: stored, source: "jev-bun-secrets" };
      }
    } catch {
      // An unavailable secret store falls through to the next source.
    }
  }
  const env = deps.env ?? process.env;
  const fromEnv = normalizeKey(env[JEV_ENDPOINT_KEY_ENV_VAR]);
  if (fromEnv) {
    return { key: fromEnv, source: "jev-env" };
  }
  const fromFile = normalizeKey((deps.readFileStore ?? readDefaultFileStore)());
  return fromFile ? { key: fromFile, source: "jev-file" } : {};
};

export const writeJevEndpointKey = async (
  key: string,
  deps: JevEndpointKeyStoreDeps = {}
): Promise<JevKeyStoreResult> => {
  const normalized = normalizeKey(key);
  if (!normalized) {
    return { message: "The endpoint API key is empty.", ok: false };
  }
  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;
  if (secrets) {
    try {
      await secrets.set({
        name: JEV_ENDPOINT_KEY_NAME,
        service: JEV_ENDPOINT_KEY_SERVICE,
        value: normalized,
      });
      return {
        message: "Endpoint API key stored in Bun.secrets.",
        ok: true,
      };
    } catch (error) {
      return {
        message: `Storing the endpoint API key in Bun.secrets failed: ${messageOf(error)}. Alternatively set ${JEV_ENDPOINT_KEY_ENV_VAR} in your shell profile.`,
        ok: false,
      };
    }
  }
  try {
    (deps.writeFileStore ?? writeDefaultFileStore)(normalized);
    return {
      message: "Endpoint API key stored in the Pi agent directory (mode 0600).",
      ok: true,
    };
  } catch (error) {
    return {
      message: `Storing the endpoint API key failed: ${messageOf(error)}. Alternatively set ${JEV_ENDPOINT_KEY_ENV_VAR} in your shell profile.`,
      ok: false,
    };
  }
};

export const clearJevEndpointKey = async (
  deps: JevEndpointKeyStoreDeps = {}
): Promise<JevKeyStoreResult> => {
  let clearedSomething = false;
  let firstError: string | undefined;
  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;
  if (secrets) {
    try {
      await secrets.delete({
        name: JEV_ENDPOINT_KEY_NAME,
        service: JEV_ENDPOINT_KEY_SERVICE,
      });
      clearedSomething = true;
    } catch (error) {
      firstError = messageOf(error);
    }
  }
  try {
    if (deps.deleteFileStore) {
      deps.deleteFileStore();
    } else if (existsSync(keyFilePath())) {
      deleteDefaultFileStore();
    }
    clearedSomething = true;
  } catch (error) {
    firstError ??= messageOf(error);
  }
  if (firstError) {
    return {
      message: `Clearing the stored endpoint API key failed: ${firstError}.`,
      ok: false,
    };
  }
  return {
    message: `Stored endpoint API key cleared.${clearedSomething ? "" : ` Nothing was stored; unset ${JEV_ENDPOINT_KEY_ENV_VAR} yourself if you use it.`}`,
    ok: true,
  };
};
