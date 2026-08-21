import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const [result] = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  })
);
const actualFiles = result.files.map(({ path }) => path).sort();
const expectedFiles = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "extensions/index.ts",
  "package.json",
  "src/commands.ts",
  "src/config.ts",
  "src/conversation.ts",
  "src/git.ts",
  "src/herdr.ts",
  "src/model-stream.ts",
  "src/outcomes.ts",
  "src/preferences.ts",
  "src/scout-context.ts",
  "src/scout.ts",
  "src/session-state.ts",
  "src/telemetry.ts",
  "src/tools.ts",
  "src/ui.ts",
  "src/untracked.ts",
];

if (
  result.name !== packageJson.name ||
  result.version !== packageJson.version
) {
  throw new Error(
    `Packed metadata mismatch: ${result.name}@${result.version} (expected ${packageJson.name}@${packageJson.version})`
  );
}

if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(`Unexpected package contents:\n${actualFiles.join("\n")}`);
}

console.log(
  `Package contents verified: ${result.name}@${result.version} (${actualFiles.length} files)`
);
