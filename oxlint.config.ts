import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core, antiSlop],
  ignorePatterns: [
    ...core.ignorePatterns,
    "bench/**",
    "dist/**",
    "docs/**",
    "tools/**",
  ],
  jsPlugins: [
    {
      name: "local-rules",
      specifier: "./tools/oxlint-rules/index.ts",
    },
  ],
  overrides: [
    {
      files: ["test/**"],
      rules: {
        // SAFETY: test doubles intentionally return synchronously and use deferred Promise constructors.
        "eslint/no-promise-executor-return": "off",
        "eslint/require-await": "off",
        "promise/avoid-new": "off",
        "typescript/no-explicit-any": "off",
      },
    },
    {
      files: ["test/helpers/**"],
      rules: {
        "typescript/no-explicit-any": "off",
      },
    },
    {
      files: ["scripts/**", "bench/**"],
      rules: {
        "no-console": "off",
      },
    },
  ],
  rules: {
    "import/extensions": ["error", "always", { ignorePackages: true }],
    // SAFETY: exported let refs are the frozen facade state contract (test/facade-exports.test.ts).
    "import/no-mutable-exports": "off",
    // SAFETY: Advisor flows are sequential by design; reordering awaits would change semantics.
    "eslint/no-await-in-loop": "off",
    "local-rules/no-undeclared-dependencies": "error",
    "no-console": ["error", { allow: ["log"] }],
    // SAFETY: repo convention is named imports for builtins; rule demands default imports (no Biome equivalent).
    "unicorn/import-style": "off",
    // SAFETY: removing `undefined` args breaks required-nullable arity and Promise<undefined> returns.
    "typescript/no-floating-promises": "error",
    "unicorn/no-useless-undefined": "off",
  },
});
