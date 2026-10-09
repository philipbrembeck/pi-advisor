import { describe, expect, test } from "bun:test";

import {
  clearJevEndpointKey,
  JEV_ENDPOINT_KEY_ENV_VAR,
  resolveJevEndpointKey,
  writeJevEndpointKey,
} from "../src/jev/endpoint-key-store.ts";
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

describe("resolveJevEndpointKey", () => {
  test("prefers the stored secret over env and the key file", async () => {
    const resolution = await resolveJevEndpointKey({
      env: { [JEV_ENDPOINT_KEY_ENV_VAR]: "env-key" },
      readFileStore: () => "file-key",
      secrets: memorySecrets(
        new Map([["pi-advisor/jev-api-key", "stored-key"]])
      ),
    });
    expect(resolution).toEqual({
      key: "stored-key",
      source: "jev-bun-secrets",
    });
  });

  test("falls back to the environment variable", async () => {
    const resolution = await resolveJevEndpointKey({
      env: { [JEV_ENDPOINT_KEY_ENV_VAR]: "env-key" },
      readFileStore: () => "file-key",
      secrets: null,
    });
    expect(resolution).toEqual({ key: "env-key", source: "jev-env" });
  });

  test("falls back to the 0600 key file", async () => {
    const resolution = await resolveJevEndpointKey({
      env: {},
      readFileStore: () => "file-key",
      secrets: null,
    });
    expect(resolution).toEqual({ key: "file-key", source: "jev-file" });
  });

  test("returns nothing when every source is empty or blank", async () => {
    const resolution = await resolveJevEndpointKey({
      env: { [JEV_ENDPOINT_KEY_ENV_VAR]: "   " },
      readFileStore: () => "\n",
      secrets: memorySecrets(),
    });
    expect(resolution).toEqual({});
  });

  test("falls through an unavailable secret store instead of failing", async () => {
    const resolution = await resolveJevEndpointKey({
      env: { [JEV_ENDPOINT_KEY_ENV_VAR]: "env-key" },
      readFileStore: () => undefined,
      secrets: failingSecrets("keychain locked"),
    });
    expect(resolution).toEqual({ key: "env-key", source: "jev-env" });
  });
});

describe("writeJevEndpointKey", () => {
  test("stores the key in Bun.secrets when the runtime provides it", async () => {
    const secrets = memorySecrets();
    const result = await writeJevEndpointKey("jv_live_key", { secrets });
    expect(result.ok).toBe(true);
    expect(secrets.stored.get("pi-advisor/jev-api-key")).toBe("jv_live_key");
  });

  test("stores the key in the agent directory when no secret store exists", async () => {
    const file = fileStoreSpy();
    const result = await writeJevEndpointKey("jv_live_key", {
      secrets: null,
      writeFileStore: file.writeFileStore,
    });
    expect(result.ok).toBe(true);
    expect(file.files).toEqual(["jv_live_key"]);
  });

  test("rejects an empty key without touching any store", async () => {
    const secrets = memorySecrets();
    const result = await writeJevEndpointKey("   ", { secrets });
    expect(result.ok).toBe(false);
    expect(secrets.stored.size).toBe(0);
  });

  test("never writes the key into advisor.json", async () => {
    const file = fileStoreSpy();
    await writeJevEndpointKey("jv_live_key", {
      secrets: null,
      writeFileStore: file.writeFileStore,
    });
    expect(file.files.join("")).not.toContain("advisor.json");
  });
});

describe("clearJevEndpointKey", () => {
  test("removes both the stored secret and the key file", async () => {
    const secrets = memorySecrets(
      new Map([["pi-advisor/jev-api-key", "stored-key"]])
    );
    const file = fileStoreSpy();
    file.writeFileStore("file-key");
    const result = await clearJevEndpointKey({
      deleteFileStore: file.deleteFileStore,
      secrets,
    });
    expect(result.ok).toBe(true);
    expect(secrets.stored.size).toBe(0);
    expect(file.files).toEqual([]);
  });

  test("reports a failure instead of claiming success", async () => {
    const result = await clearJevEndpointKey({
      deleteFileStore: () => undefined,
      secrets: failingSecrets("keychain locked"),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toBeString();
  });
});
