import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PI_ADVISOR_VERSION } from "../src/package-version.js";

interface PackageManifest {
  version: string;
}

const packageManifest = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json"),
    "utf8"
  )
) as PackageManifest;

describe("bench package version", () => {
  test("follows the package manifest", () => {
    expect(PI_ADVISOR_VERSION).toBe(packageManifest.version);
  });
});
