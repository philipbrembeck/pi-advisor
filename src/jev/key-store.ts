import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { readExistingConfig, resetConfigCache } from "../config/storage.ts";
import { isString } from "../content-utils.ts";
import type { RecordValue } from "../content-utils.ts";
import { redactSecrets } from "../redaction.ts";

export type JevKeySource = "bun-secrets" | "env" | "file" | "advisor-json";

export interface JevKeyResolution {
  key?: string;
  /** Present whenever a key resolved. */
  source?: JevKeySource;
}

export interface JevKeyStoreResult {
  message: string;
  ok: boolean;
}

export interface JevSecretEntry {
  name: string;
  service: string;
}

export interface JevSecretsLike {
  delete: (options: JevSecretEntry) => Promise<boolean | undefined>;
  get: (options: JevSecretEntry) => Promise<string | null | undefined>;
  set: (options: JevSecretEntry & { value: string }) => Promise<void>;
}

export interface JevKeyStoreDeps {
  /** Deletes the extension-managed key file; injectable for tests. */
  deleteFileStore?: () => void;
  env?: NodeJS.ProcessEnv;
  readAdvisorJson?: () => RecordValue;
  /** Reads the extension-managed 0600 key file; injectable for tests. */
  readFileStore?: () => string | undefined;
  /** Inject `null` to simulate a runtime without a secret store. */
  secrets?: JevSecretsLike | null;
  writeFileStore?: (key: string) => void;
}

export const TYPESAFE_KEY_ENV_VAR = "TYPESAFE_API_KEY";
export const TYPESAFE_KEY_SERVICE = "pi-advisor";
export const TYPESAFE_KEY_NAME = "typesafe-api-key";
export const TYPESAFE_KEY_CONFIG_FIELD = "typesafe_api_key";

const KEY_FILE_MODE = 0o600;

const keyFilePath = () => join(getAgentDir(), "typesafe_api_key");

interface BunGlobal {
  Bun?: { secrets?: JevSecretsLike };
}

const runtimeSecrets = (): JevSecretsLike | undefined => {
  // SAFETY: only Bun runtimes expose Bun.secrets on globalThis; others leave it undefined.
  const bun = globalThis as BunGlobal;
  return bun.Bun?.secrets;
};

/** Whether the current runtime offers a Bun.secrets store. */
export const hasRuntimeSecretStore = () => runtimeSecrets() !== undefined;

const normalizeKey = (value: string | null | undefined): string | undefined =>
  value?.trim() || undefined;

const readAdvisorJsonConfig = (): RecordValue =>
  readExistingConfig(join(getAgentDir(), "advisor.json"));

const defaultReadFileStore = (): string | undefined => {
  try {
    return normalizeKey(readFileSync(keyFilePath(), "utf-8"));
  } catch {
    return undefined;
  }
};

const defaultWriteFileStore = (key: string) => {
  const path = keyFilePath();
  writeFileSync(path, `${key}\n`, { mode: KEY_FILE_MODE });
  // writeFileSync's mode only applies at creation; re-assert it on every write.
  chmodSync(path, KEY_FILE_MODE);
};

const defaultDeleteFileStore = () => {
  rmSync(keyFilePath(), { force: true });
};

const messageOf = <E>(error: E) =>
  redactSecrets(error instanceof Error ? error.message : String(error));

/** Resolves the TypeSafe API key: Bun.secrets → env var → the extension's
 * 0600 key file → a hand-placed advisor.json string (read-only). Never
 * throws; no key means undefined. */
export const resolveTypeSafeKey = async (
  deps: JevKeyStoreDeps = {}
): Promise<JevKeyResolution> => {
  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;
  if (secrets) {
    try {
      const stored = normalizeKey(
        await secrets.get({
          name: TYPESAFE_KEY_NAME,
          service: TYPESAFE_KEY_SERVICE,
        })
      );
      if (stored) {
        return { key: stored, source: "bun-secrets" };
      }
    } catch {
      // An unavailable secret store falls through to the next source.
    }
  }
  const env = deps.env ?? process.env;
  const fromEnv = normalizeKey(env[TYPESAFE_KEY_ENV_VAR]);
  if (fromEnv) {
    return { key: fromEnv, source: "env" };
  }
  const readFileStore = deps.readFileStore ?? defaultReadFileStore;
  const fromFile = normalizeKey(readFileStore());
  if (fromFile) {
    return { key: fromFile, source: "file" };
  }
  const config = (deps.readAdvisorJson ?? readAdvisorJsonConfig)();
  const staged = config[TYPESAFE_KEY_CONFIG_FIELD];
  if (isString(staged)) {
    const fromConfig = normalizeKey(staged);
    if (fromConfig) {
      return { key: fromConfig, source: "advisor-json" };
    }
  }
  return {};
};

/** Stores the key securely: Bun.secrets when the runtime provides it,
 * otherwise a dedicated 0600-mode file in the Pi agent directory. The key is
 * never written to advisor.json. */
export const writeKeyTypeSafeKey = async (
  key: string,
  deps: JevKeyStoreDeps = {}
): Promise<JevKeyStoreResult> => {
  const normalized = normalizeKey(key);
  if (!normalized) {
    return { message: "The key is empty.", ok: false };
  }
  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;
  if (secrets) {
    try {
      await secrets.set({
        name: TYPESAFE_KEY_NAME,
        service: TYPESAFE_KEY_SERVICE,
        value: normalized,
      });
      return { message: "Key stored in Bun.secrets.", ok: true };
    } catch (error) {
      return {
        message: `Storing the key in Bun.secrets failed: ${messageOf(error)}. Alternatively set the ${TYPESAFE_KEY_ENV_VAR} environment variable in your shell profile.`,
        ok: false,
      };
    }
  }
  try {
    (deps.writeFileStore ?? defaultWriteFileStore)(normalized);
    return {
      message: "Key stored in ~/.pi/agent/typesafe_api_key (mode 0600).",
      ok: true,
    };
  } catch (error) {
    return {
      message: `Storing the key failed: ${messageOf(error)}. Alternatively set the ${TYPESAFE_KEY_ENV_VAR} environment variable in your shell profile.`,
      ok: false,
    };
  }
};

/** Removes every stored key (Bun.secrets entry and the 0600 file); never
 * touches env vars or the hand-placed advisor.json entry. */
export const clearKeyTypeSafeKey = async (
  deps: JevKeyStoreDeps = {}
): Promise<JevKeyStoreResult> => {
  let clearedSomething = false;
  let firstError: string | undefined;
  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;
  if (secrets) {
    try {
      await secrets.delete({
        name: TYPESAFE_KEY_NAME,
        service: TYPESAFE_KEY_SERVICE,
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
      defaultDeleteFileStore();
    }
    clearedSomething = true;
  } catch (error) {
    firstError ??= messageOf(error);
  }
  if (firstError) {
    return {
      message: `Clearing the stored key failed: ${firstError}.`,
      ok: false,
    };
  }
  return {
    message: `Stored key cleared.${clearedSomething ? "" : ` Nothing was stored; unset ${TYPESAFE_KEY_ENV_VAR} and remove ${TYPESAFE_KEY_CONFIG_FIELD} from advisor.json yourself if you use them.`}`,
    ok: true,
  };
};

/** Removes a hand-placed advisor.json key after a successful store migration.
 * Unknown keys and all config settings are preserved verbatim. */
export const removeTypeSafeKeyFromAdvisorJson = (): JevKeyStoreResult => {
  try {
    const path = join(getAgentDir(), "advisor.json");
    const existing = readExistingConfig(path);
    if (!(TYPESAFE_KEY_CONFIG_FIELD in existing)) {
      return { message: "No plaintext key in advisor.json.", ok: true };
    }
    const retained = Object.fromEntries(
      Object.entries(existing).filter(
        ([key]) => key !== TYPESAFE_KEY_CONFIG_FIELD
      )
    );
    writeFileSync(path, `${JSON.stringify(retained, null, 2)}\n`);
    resetConfigCache();
    return { message: "Plaintext key removed from advisor.json.", ok: true };
  } catch (error) {
    return {
      message: `Removing the plaintext key failed: ${messageOf(error)}.`,
      ok: false,
    };
  }
};

let warnedPlaintextKey = false;

/** Returns the plaintext-key warning once so callers can notify without spam. */
export const consumePlaintextKeyWarning = (): string | undefined => {
  if (warnedPlaintextKey) {
    return undefined;
  }
  warnedPlaintextKey = true;
  return `Advisor is using a plaintext ${TYPESAFE_KEY_CONFIG_FIELD} from advisor.json; this is not recommended. Open /advisor-settings → Jev consultation filter to migrate it into a secure store, or use the ${TYPESAFE_KEY_ENV_VAR} environment variable.`;
};

/** Test-only: re-arms the one-time plaintext warning. */
export const resetPlaintextKeyWarning = () => {
  warnedPlaintextKey = false;
};
