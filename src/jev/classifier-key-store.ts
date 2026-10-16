import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface JevClassifierSecrets {
  delete: (options: {
    name: string;
    service: string;
  }) => Promise<boolean | undefined>;
  get: (options: {
    name: string;
    service: string;
  }) => Promise<string | null | undefined>;
  set: (options: {
    name: string;
    service: string;
    value: string;
  }) => Promise<void>;
}

export interface JevClassifierKeyStoreDeps {
  readFile?: () => string | undefined;
  secrets?: JevClassifierSecrets | null;
  writeFile?: (key: string) => void;
}

export interface JevClassifierKeySnapshot {
  key?: string;
  source?: "bun-secrets" | "file";
}

export const JEV_CLASSIFIER_KEY_SERVICE = "pi-advisor-jev-classifier";
export const JEV_CLASSIFIER_KEY_NAME = "classifier-api-key";
const KEY_FILE_MODE = 0o600;
const keyFilePath = () => join(getAgentDir(), "jev_classifier_api_key");
let classifierKeyFailClosed = false;

export const disableJevClassifierKeyForRuntime = () => {
  classifierKeyFailClosed = true;
};

export const enableJevClassifierKeyForRuntime = () => {
  classifierKeyFailClosed = false;
};

interface BunGlobal {
  Bun?: { secrets?: JevClassifierSecrets };
}

const runtimeSecrets = () => {
  // SAFETY: Bun.secrets is only present on Bun runtimes; Node loaders use the 0600 file fallback.
  const bun = globalThis as BunGlobal;

  return bun.Bun?.secrets;
};

const defaultReadFile = () => {
  try {
    return readFileSync(keyFilePath(), "utf-8").trim() || undefined;
  } catch {
    return undefined;
  }
};

const defaultWriteFile = (key: string) => {
  const path = keyFilePath();
  writeFileSync(path, `${key}\n`, { mode: KEY_FILE_MODE });
  chmodSync(path, KEY_FILE_MODE);
};

export const readJevClassifierKey = async (
  deps: JevClassifierKeyStoreDeps = {}
): Promise<JevClassifierKeySnapshot> => {
  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;

  if (secrets) {
    try {
      const storedValue = await secrets.get({
        name: JEV_CLASSIFIER_KEY_NAME,
        service: JEV_CLASSIFIER_KEY_SERVICE,
      });

      const key = storedValue?.trim();

      if (key) {
        return { key, source: "bun-secrets" };
      }
    } catch {
      return {};
    }
  }

  const key = (deps.readFile ?? defaultReadFile)();

  return key ? { key, source: "file" } : {};
};

export const writeJevClassifierKey = async (
  key: string,
  deps: JevClassifierKeyStoreDeps = {}
): Promise<{ ok: boolean; message: string }> => {
  const normalized = key.trim();

  if (!normalized) {
    return { message: "The key is empty.", ok: false };
  }

  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;

  if (secrets) {
    try {
      await secrets.set({
        name: JEV_CLASSIFIER_KEY_NAME,
        service: JEV_CLASSIFIER_KEY_SERVICE,
        value: normalized,
      });

      return { message: "Jev classifier key stored securely.", ok: true };
    } catch {
      return {
        message: "Could not store the Jev classifier key securely.",
        ok: false,
      };
    }
  }

  try {
    (deps.writeFile ?? defaultWriteFile)(normalized);

    return {
      message: "Jev classifier key stored in a 0600-mode file.",
      ok: true,
    };
  } catch {
    return {
      message: "Could not store the Jev classifier key securely.",
      ok: false,
    };
  }
};

export const restoreJevClassifierKey = async (
  previous: JevClassifierKeySnapshot,
  deps: JevClassifierKeyStoreDeps = {}
): Promise<boolean> => {
  if (previous.key) {
    const result = await writeJevClassifierKey(previous.key, deps);

    return result.ok;
  }

  if (deps.secrets === null && deps.writeFile) {
    return true;
  }

  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;
  let secretCleared = true;

  if (secrets) {
    try {
      await secrets.delete({
        name: JEV_CLASSIFIER_KEY_NAME,
        service: JEV_CLASSIFIER_KEY_SERVICE,
      });
    } catch {
      secretCleared = false;
    }
  }

  try {
    if (deps.secrets === undefined && !secrets) {
      rmSync(keyFilePath(), { force: true });
    }
  } catch {
    return false;
  }

  return secretCleared;
};

export const consumeJevClassifierKey = async () => {
  if (classifierKeyFailClosed) {
    return undefined;
  }

  const stored = await readJevClassifierKey();

  return stored.key;
};

export const writeJevClassifierKeyCandidate = async (key: string) => {
  const previous = await readJevClassifierKey();
  const written = await writeJevClassifierKey(key);

  return { previous, written };
};
