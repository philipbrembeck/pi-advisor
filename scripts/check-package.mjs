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
  "src/config/args.ts",
  "src/config/defaults.ts",
  "src/config/state.ts",
  "src/config/storage.ts",
  "src/config/types.ts",
  "src/config/validation.ts",
  "src/conversation.ts",
  "src/git.ts",
  "src/herdr.ts",
  "src/model-stream.ts",
  "src/outcomes.ts",
  "src/preferences.ts",
  "src/scout-context.ts",
  "src/scout.ts",
  "src/session-state.ts",
  "src/tools.ts",
  "src/tools/consultation.ts",
  "src/tools/gate-policy.ts",
  "src/tools/gate-protocol.ts",
  "src/tools/loop-gate.ts",
  "src/tools/prompts.ts",
  "src/tools/register-ask-advisor.ts",
  "src/tools/register-lifecycle.ts",
  "src/tools/register-outcome.ts",
  "src/tools/register-renderers.ts",
  "src/tools/registration.ts",
  "src/tools/render-advisor-result.ts",
  "src/tools/render-common.ts",
  "src/tools/scout-status.ts",
  "src/tools/session.ts",
  "src/tools/types.ts",
  "src/ui.ts",
  "src/ui/manual-dialog-render.ts",
  "src/ui/manual-dialog.ts",
  "src/ui/model-selector.ts",
  "src/ui/settings-formatting.ts",
  "src/ui/settings-items.ts",
  "src/ui/settings-list-adapter.ts",
  "src/ui/settings-mutations.ts",
  "src/ui/settings-selector.ts",
  "src/ui/text-setting-submenu.ts",
  "src/ui/types.ts",
  "src/untracked.ts",
  "src/usage.ts",
];

const benchmarkFiles = actualFiles.filter(
  (path) => path === "bench" || path.startsWith("bench/")
);
if (benchmarkFiles.length > 0) {
  throw new Error(
    `Repository-only benchmark files leaked into the package:\n${benchmarkFiles.join("\n")}`
  );
}

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
