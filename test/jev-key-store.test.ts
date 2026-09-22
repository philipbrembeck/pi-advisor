import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearKeyTypeSafeKey,
  consumePlaintextKeyWarning,
  resetPlaintextKeyWarning,
  resolveTypeSafeKey,
  writeKeyTypeSafeKey,
} from "../src/jev/key-store.ts";
import type { JevSecretsLike } from "../src/jev/key-store.ts";

const fileStoreSpy = () => {
  const written: string[] = [];
  return {
    deleteFileStore: () => {
      written.pop();
    },
    files: written,
    readFileStore: () => written.at(-1),
    writeFileStore: (key: string) => written.push(key),
  };
};

const keyOf = (options: { name: string; service: string }) =>
  `${options.service}/${options.name}`;

const memorySecrets = (
  initial?: Map<string, string>
): JevSecretsLike & { stored: Map<string, string> } => {
  const stored = initial ?? new Map<string, string>();
  return {
    delete: (options) => {
      stored.delete(keyOf(options));
      return Promise.resolve(true);
    },
    get: (options) => Promise.resolve(stored.get(keyOf(options))),
    set: (options) => {
      stored.set(keyOf(options), options.value);
      return Promise.resolve();
    },
    stored,
  };
};

const failingSecrets = (message: string): JevSecretsLike => ({
  delete: () => Promise.reject(new Error(message)),
  get: () => Promise.reject(new Error(message)),
  set: () => Promise.reject(new Error(message)),
});

afterEach(() => {
  resetPlaintextKeyWarning();
});

describe("resolveTypeSafeKey", () => {
  test("prefers Bun.secrets over env and advisor.json", async () => {
    const resolution = await resolveTypeSafeKey({
      env: { TYPESAFE_API_KEY: "env-key" },
      readAdvisorJson: () => ({ typesafe_api_key: "config-key" }),
      readFileStore: () => {},
      secrets: memorySecrets(
        new Map([["pi-advisor/typesafe-api-key", "stored-key"]])
      ),
    });
    expect(resolution).toEqual({ key: "stored-key", source: "bun-secrets" });
  });

  test("falls back to the env var when no secret is stored", async () => {
    const resolution = await resolveTypeSafeKey({
      env: { TYPESAFE_API_KEY: "  env-key \n" },
      readAdvisorJson: () => ({ typesafe_api_key: "config-key" }),
      readFileStore: () => {},
      secrets: memorySecrets(),
    });
    expect(resolution).toEqual({ key: "env-key", source: "env" });
  });

  test("falls back to a hand-placed advisor.json key last", async () => {
    const resolution = await resolveTypeSafeKey({
      env: {},
      readAdvisorJson: () => ({ typesafe_api_key: " config-key\n" }),
      readFileStore: () => {},
      secrets: null,
    });
    expect(resolution).toEqual({ key: "config-key", source: "advisor-json" });
  });

  test("resolves nothing without throwing when every source is empty", async () => {
    const resolution = await resolveTypeSafeKey({
      env: {},
      readAdvisorJson: () => ({}),
      readFileStore: () => {},
      secrets: null,
    });
    expect(resolution).toEqual({});
  });

  test("resolves the 0600 file store after env and before advisor.json", async () => {
    const fromFile = await resolveTypeSafeKey({
      env: {},
      readAdvisorJson: () => ({ typesafe_api_key: "config-key" }),
      readFileStore: () => " file-key\n",
      secrets: null,
    });
    expect(fromFile).toEqual({ key: "file-key", source: "file" });
    const envWins = await resolveTypeSafeKey({
      env: { TYPESAFE_API_KEY: "env-key" },
      readAdvisorJson: () => ({}),
      readFileStore: () => "file-key",
      secrets: null,
    });
    expect(envWins).toEqual({ key: "env-key", source: "env" });
  });

  test("skips an unavailable secret store instead of throwing", async () => {
    const resolution = await resolveTypeSafeKey({
      env: { TYPESAFE_API_KEY: "env-key" },
      readAdvisorJson: () => ({}),
      secrets: failingSecrets("keychain locked"),
    });
    expect(resolution).toEqual({ key: "env-key", source: "env" });
  });

  test("ignores a non-string advisor.json entry", async () => {
    const resolution = await resolveTypeSafeKey({
      env: {},
      readAdvisorJson: () => ({ typesafe_api_key: 42 }),
      readFileStore: () => {},
      secrets: null,
    });
    expect(resolution).toEqual({});
  });
});

describe("writeKeyTypeSafeKey", () => {
  test("stores a normalized key in Bun.secrets and creates no file", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-keystore-"));
    try {
      const secrets = memorySecrets();
      const files = fileStoreSpy();
      const result = await writeKeyTypeSafeKey("  pasted-key \n", {
        env: {},
        ...files,
        readAdvisorJson: () => ({}),
        secrets,
      });
      expect(result.ok).toBe(true);
      expect(secrets.stored.get("pi-advisor/typesafe-api-key")).toBe(
        "pasted-key"
      );
      expect(readdirSync(agentDir)).toEqual([]);
    } finally {
      rmSync(agentDir, { force: true, recursive: true });
    }
  });

  test("writes the 0600 file store when Bun.secrets is unavailable", async () => {
    const files = fileStoreSpy();
    const result = await writeKeyTypeSafeKey(" key ", {
      env: {},
      ...files,
      readAdvisorJson: () => ({}),
      secrets: null,
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("0600");
    expect(files.files).toEqual(["key"]);
  });

  test("reports a file-store write failure with the env alternative", async () => {
    const result = await writeKeyTypeSafeKey("key", {
      env: {},
      readAdvisorJson: () => ({}),
      readFileStore: () => {},
      secrets: null,
      writeFileStore: () => {
        throw new Error("disk full");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("disk full");
    expect(result.message).toContain("TYPESAFE_API_KEY");
  });

  test("surfaces a secret-store write failure redacted", async () => {
    const result = await writeKeyTypeSafeKey("key", {
      env: {},
      ...fileStoreSpy(),
      readAdvisorJson: () => ({}),
      secrets: failingSecrets("write denied"),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("write denied");
    expect(result.message).toContain("TYPESAFE_API_KEY");
  });

  test("rejects an empty key", async () => {
    const result = await writeKeyTypeSafeKey("  \n", {
      env: {},
      ...fileStoreSpy(),
      readAdvisorJson: () => ({}),
      secrets: memorySecrets(),
    });
    expect(result.ok).toBe(false);
  });
});

describe("clearKeyTypeSafeKey", () => {
  test("deletes the stored secret only", async () => {
    const secrets = memorySecrets(
      new Map([["pi-advisor/typesafe-api-key", "stored-key"]])
    );
    const result = await clearKeyTypeSafeKey({
      env: {},
      ...fileStoreSpy(),
      readAdvisorJson: () => ({}),
      secrets,
    });
    expect(result.ok).toBe(true);
    expect(secrets.stored.has("pi-advisor/typesafe-api-key")).toBe(false);
  });

  test("clears the stored file even without a secret store", async () => {
    const result = await clearKeyTypeSafeKey({
      env: { TYPESAFE_API_KEY: "env-key" },
      ...fileStoreSpy(),
      readAdvisorJson: () => ({}),
      secrets: null,
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("cleared");
  });
});

describe("consumePlaintextKeyWarning", () => {
  test("returns the warning exactly once", () => {
    const first = consumePlaintextKeyWarning();
    expect(first).toContain("typesafe_api_key");
    expect(consumePlaintextKeyWarning()).toBeUndefined();
  });
});
