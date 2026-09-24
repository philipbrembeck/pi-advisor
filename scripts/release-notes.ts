import { readFileSync } from "node:fs";

const headingVersion = (line: string): string | undefined => {
  const match = /^##\s+\[?(?<version>v?\d+\.\d+\.\d+)\]?(?:\s|$)/u.exec(line);
  return match?.groups?.version?.replace(/^v/u, "");
};

export const extractReleaseNotes = (
  changelog: string,
  version: string
): string => {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error("Expected a stable version in x.y.z format.");
  }

  const lines = changelog.split(/\r?\n/u);
  const start = lines.findIndex((line) => headingVersion(line) === version);

  if (start === -1) {
    throw new Error(`No changelog entry found for ${version}.`);
  }

  let end = start + 1;
  while (end < lines.length && !/^##\s/u.test(lines[end] ?? "")) {
    end += 1;
  }

  const notes = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  if (!notes) {
    throw new Error(`The changelog entry for ${version} is empty.`);
  }

  return notes;
};

if (import.meta.main) {
  const [version, changelogPath = "CHANGELOG.md"] = process.argv.slice(2);
  try {
    if (!version) {
      throw new Error("Expected a stable version in x.y.z format.");
    }
    process.stdout.write(
      `${extractReleaseNotes(readFileSync(changelogPath, "utf-8"), version)}\n`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
