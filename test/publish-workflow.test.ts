import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

interface PackageManifest {
  files: string[];
}

const isString = (value: unknown): value is string => typeof value === "string";

const isPackageManifest = (value: unknown): value is PackageManifest =>
  value !== null &&
  typeof value === "object" &&
  "files" in value &&
  Array.isArray(value.files) &&
  value.files.every(isString);

const repositoryRoot = resolve(import.meta.dirname, "..");
const parsedPackageJson: unknown = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf-8")
);
if (!isPackageManifest(parsedPackageJson)) {
  throw new TypeError("Expected package.json files to be a string array.");
}
const workflow = readFileSync(
  join(repositoryRoot, ".github/workflows/publish.yml"),
  "utf-8"
);

describe("npm preview workflow", () => {
  test("watches the files included in the package", () => {
    const lines = workflow.split(/\r?\n/u);
    const pathsIndex = lines.indexOf("    paths:");
    if (pathsIndex === -1) {
      throw new Error("Missing push path filters.");
    }

    const configuredPaths: string[] = [];
    for (const line of lines.slice(pathsIndex + 1)) {
      const match = /^ {6}- (?<path>.+)$/u.exec(line);
      if (!match?.groups?.path) {
        break;
      }
      configuredPaths.push(match.groups.path.replaceAll(/^["']|["']$/gu, ""));
    }

    const expectedPaths = [
      "package.json",
      ...parsedPackageJson.files.map((path) =>
        statSync(join(repositoryRoot, path)).isDirectory() ? `${path}/**` : path
      ),
    ];

    expect(configuredPaths.toSorted()).toEqual(expectedPaths.toSorted());
  });

  test("keeps previews on dev and stable publishing on release refs", () => {
    expect(workflow).toContain(
      "if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/')"
    );
    expect(workflow).toContain(
      "npm publish --access public --provenance --tag=dev"
    );
  });
});
