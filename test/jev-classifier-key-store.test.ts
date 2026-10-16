import { describe, expect, test } from "bun:test";

import {
  JEV_CLASSIFIER_KEY_NAME,
  JEV_CLASSIFIER_KEY_SERVICE,
  readJevClassifierKey,
  restoreJevClassifierKey,
  writeJevClassifierKey,
} from "../src/jev/classifier-key-store.ts";
import type { JevClassifierSecrets } from "../src/jev/classifier-key-store.ts";
import { JevClassifierKeyStoreHarness } from "./helpers/jev-classifier-key-store.ts";

describe("isolated Jev classifier key store", () => {
  test("uses a new secure-store namespace only", async () => {
    const calls: string[] = [];

    const secrets: JevClassifierSecrets = {
      delete: async (entry) => {
        calls.push(`delete:${entry.service}/${entry.name}`);

        return true;
      },
      get: async (entry) => {
        calls.push(`get:${entry.service}/${entry.name}`);

        return "new-classifier-key";
      },
      set: async (entry) => {
        calls.push(`set:${entry.service}/${entry.name}`);
      },
    };

    expect(await readJevClassifierKey({ secrets })).toEqual({
      key: "new-classifier-key",
      source: "bun-secrets",
    });
    expect(
      await writeJevClassifierKey("replacement", { secrets })
    ).toMatchObject({ ok: true });
    expect(calls).toEqual([
      `get:${JEV_CLASSIFIER_KEY_SERVICE}/${JEV_CLASSIFIER_KEY_NAME}`,
      `set:${JEV_CLASSIFIER_KEY_SERVICE}/${JEV_CLASSIFIER_KEY_NAME}`,
    ]);
    expect(calls.join(" ")).not.toContain("typesafe-api-key");
  });

  test("missing store does not inspect environment variables or legacy stores", async () => {
    const fileReads: string[] = [];

    const result = await readJevClassifierKey({
      readFile: () => {
        fileReads.push("new-file");

        return undefined;
      },
      secrets: null,
    });

    expect(result).toEqual({});
    expect(fileReads).toEqual(["new-file"]);
  });

  test("rejects empty keys and restores keyless prior state", async () => {
    const writes: string[] = [];
    expect(
      await writeJevClassifierKey("  ", {
        secrets: null,
        writeFile: (key) => writes.push(key),
      })
    ).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
    expect(await restoreJevClassifierKey({}, { secrets: null })).toBe(true);
  });

  test("a failed secure-store read reports an unknown state without file fallback", async () => {
    const fileReads: string[] = [];

    const secrets: JevClassifierSecrets = {
      delete: async () => true,
      get: async () => {
        throw new Error("keychain locked");
      },
      set: async () => {},
    };

    const result = await readJevClassifierKey({
      readFile: () => {
        fileReads.push("read");

        return "file-key";
      },
      secrets,
    });

    expect(result).toEqual({ failed: true });
    expect(fileReads).toEqual([]);
  });

  test("restore refuses to mutate the store when the previous state is unknown", async () => {
    const harness = new JevClassifierKeyStoreHarness("old-key");

    expect(await restoreJevClassifierKey({ failed: true }, harness.deps)).toBe(
      false
    );
    expect(harness.calls).toEqual([]);
    expect(harness.value).toBe("old-key");
  });
});
