import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadManifest } from "../swebench/adapter.js";
import {
  canonicalJsonHash,
  semanticManifestIdentity,
} from "../swebench/manifest-identity.js";

const manifestPath = "benchmarks/swebench/hard-baseline-v2-manifest.json";
const manifest = loadManifest(manifestPath);
const provenance = JSON.parse(
  readFileSync(
    "benchmarks/swebench/artifacts/hard-baseline-v2/selection-provenance.json",
    "utf8"
  )
) as Record<string, unknown>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const identity = (value = manifest, metadata = provenance) =>
  semanticManifestIdentity(value, metadata);

describe("semantic SWE-bench manifest identity", () => {
  test("matches the frozen legacy canonical SHA", () => {
    expect(canonicalJsonHash(manifest)).toBe(
      "44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193"
    );
  });

  test("ignores JSON formatting and mutable preflight metadata", () => {
    const reformatted = JSON.parse(JSON.stringify(manifest, null, 2));
    expect(identity(reformatted)).toBe(identity());
    expect(
      identity(manifest, {
        ...provenance,
        generatedAt: "now",
        preflight: { ready: 9 },
      })
    ).toBe(identity());
  });

  test.each([
    ["task order", (value: typeof manifest) => value.tasks.reverse()],
    [
      "instance ID",
      (value: typeof manifest) => {
        value.tasks[0].instanceId = "changed";
      },
    ],
    [
      "base commit",
      (value: typeof manifest) => {
        value.tasks[0].baseCommit = "changed";
      },
    ],
    [
      "test patch hash",
      (value: typeof manifest) => {
        value.tasks[0].testPatchSha256 = "sha256:changed";
      },
    ],
    [
      "gold patch hash",
      (value: typeof manifest) => {
        value.tasks[0].solutionPatchSha256 = "sha256:changed";
      },
    ],
    [
      "FAIL_TO_PASS",
      (value: typeof manifest) => {
        value.tasks[0].failToPass = ["changed"];
      },
    ],
    [
      "PASS_TO_PASS",
      (value: typeof manifest) => {
        value.tasks[0].passToPass = ["changed"];
      },
    ],
  ])("changes identity when %s changes", (_name, mutate) => {
    const changed = clone(manifest);
    mutate(changed);
    expect(identity(changed)).not.toBe(identity());
  });

  test("changes identity when a selection criterion changes", () => {
    const changed = clone(provenance);
    const selection = clone(changed.selection) as Record<string, unknown>[];
    selection[0].criterion = "changed";
    changed.selection = selection;
    expect(identity(manifest, changed)).not.toBe(identity());
  });

  test("changes identity when a selection metric changes", () => {
    const changed = clone(provenance);
    changed.selectedProductionLines20OrExpressionCount = 999;
    expect(identity(manifest, changed)).not.toBe(identity());
  });
});
