import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core, antiSlop],
  ignorePatterns: [...core.ignorePatterns, "bench/**", "dist/**", "docs/**"],
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
      files: ["src/git.ts"],
      rules: {
        // SAFETY: execFile is callback-based; this adapter intentionally wraps it in one deferred promise.
        "promise/avoid-new": "off",
        "promise/prefer-await-to-callbacks": "off",
      },
    },
    {
      files: ["src/image-validation.ts"],
      rules: {
        // SAFETY: binary image-format field extraction is the intended use of bitwise operators.
        "eslint/no-bitwise": "off",
        "unicorn/numeric-separators-style": "off",
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
    // SAFETY: Advisor flows are sequential by design; reordering awaits would change semantics.
    "eslint/no-await-in-loop": "off",
    "import/extensions": ["error", "always", { ignorePackages: true }],
    // SAFETY: exported let refs are the frozen facade state contract (test/facade-exports.test.ts).
    "import/no-mutable-exports": "off",
    "local-rules/no-undeclared-dependencies": "error",
    "no-console": ["error", { allow: ["log"] }],
    "typescript/no-floating-promises": "error",
    // SAFETY: repo convention is named imports for builtins; rule demands default imports (no Biome equivalent).
    "unicorn/import-style": "off",
    // SAFETY: removing `undefined` args breaks required-nullable arity and Promise<undefined> returns.
    "unicorn/no-useless-undefined": "off",
  },
});
