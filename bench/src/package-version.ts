import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  version?: unknown;
}

const packageManifestPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../package.json"
);
const packageManifest = JSON.parse(
  readFileSync(packageManifestPath, "utf8")
) as PackageManifest;

if (
  typeof packageManifest.version !== "string" ||
  packageManifest.version.trim() === ""
) {
  throw new TypeError(
    `Package version is missing from ${packageManifestPath}.`
  );
}

export const PI_ADVISOR_VERSION = packageManifest.version;
