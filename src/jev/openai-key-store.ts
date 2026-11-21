import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { redactSecrets } from "../redaction.ts";
import { writeKeyFile } from "./key-file.ts";
import type { JevKeyStoreResult, JevSecretsLike } from "./key-store.ts";

export const OPENAI_DECISIONS_KEY_SERVICE = "pi-advisor";
export const OPENAI_DECISIONS_KEY_NAME = "openai-decisions-api-key";

type OpenAIDecisionsKeySource = "openai-bun-secrets" | "openai-file";

export interface OpenAIDecisionsKeyResolution {
  key?: string;
  source?: OpenAIDecisionsKeySource;
}

export interface OpenAIDecisionsKeyStoreDeps {
  deleteFileStore?: () => void;
  readFileStore?: () => string | undefined;
  secrets?: JevSecretsLike | null;
  writeFileStore?: (key: string) => void;
}

interface BunGlobal {
  Bun?: { secrets?: JevSecretsLike };
}

const runtimeSecrets = (): JevSecretsLike | undefined => {
  // SAFETY: only Bun runtimes expose Bun.secrets; other hosts leave the property absent.
  const bun = globalThis as BunGlobal;

  return bun.Bun?.secrets;
};

const keyFilePath = () => join(getAgentDir(), "openai_api_key");

const normalizeKey = (value: string | null | undefined) =>
  value?.trim() || undefined;

const readDefaultFileStore = (): string | undefined => {
  try {
    return normalizeKey(readFileSync(keyFilePath(), "utf-8"));
  } catch {
    return undefined;
  }
};

const writeDefaultFileStore = (key: string) => writeKeyFile(keyFilePath(), key);

const deleteDefaultFileStore = () => rmSync(keyFilePath(), { force: true });

const messageOf = <Error>(error: Error) =>
  redactSecrets(error instanceof Error ? error.message : String(error));

export const resolveOpenAIDecisionsKey = async (
  deps: OpenAIDecisionsKeyStoreDeps = {}
): Promise<OpenAIDecisionsKeyResolution> => {
  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;

  if (secrets) {
    let secretKey: string | undefined;

    try {
      secretKey = normalizeKey(
        await secrets.get({
          name: OPENAI_DECISIONS_KEY_NAME,
          service: OPENAI_DECISIONS_KEY_SERVICE,
        })
      );
    } catch {
      secretKey = undefined;
    }

    if (secretKey) {
      return { key: secretKey, source: "openai-bun-secrets" };
    }
  }

  const key = normalizeKey((deps.readFileStore ?? readDefaultFileStore)());

  return key ? { key, source: "openai-file" } : {};
};

export const writeOpenAIDecisionsKey = async (
  key: string,
  deps: OpenAIDecisionsKeyStoreDeps = {}
): Promise<JevKeyStoreResult> => {
  const normalized = normalizeKey(key);

  if (!normalized) {
    return { message: "The OpenAI API key is empty.", ok: false };
  }

  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;

  if (secrets) {
    try {
      await secrets.set({
        name: OPENAI_DECISIONS_KEY_NAME,
        service: OPENAI_DECISIONS_KEY_SERVICE,
        value: normalized,
      });

      return { message: "OpenAI API key stored in Bun.secrets.", ok: true };
    } catch (error) {
      return {
        message: `Storing the OpenAI API key in Bun.secrets failed: ${messageOf(error)}. Configure OPENAI_API_KEY in Pi or retry secure storage.`,
        ok: false,
      };
    }
  }

  try {
    (deps.writeFileStore ?? writeDefaultFileStore)(normalized);

    return {
      message: "OpenAI API key stored in the Pi agent directory (mode 0600).",
      ok: true,
    };
  } catch (error) {
    return {
      message: `Storing the OpenAI API key failed: ${messageOf(error)}. Configure OPENAI_API_KEY in Pi or retry secure storage.`,
      ok: false,
    };
  }
};

export const clearOpenAIDecisionsKey = async (
  deps: OpenAIDecisionsKeyStoreDeps = {}
): Promise<JevKeyStoreResult> => {
  let firstError: string | undefined;
  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;

  if (secrets) {
    try {
      await secrets.delete({
        name: OPENAI_DECISIONS_KEY_NAME,
        service: OPENAI_DECISIONS_KEY_SERVICE,
      });
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
  } catch (error) {
    firstError ??= messageOf(error);
  }

  if (firstError) {
    return {
      message: `Clearing the OpenAI API key failed: ${firstError}.`,
      ok: false,
    };
  }

  return { message: "Stored OpenAI API key cleared.", ok: true };
};
