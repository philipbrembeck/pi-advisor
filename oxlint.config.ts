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
    "local-rules/no-undeclared-dependencies": "error",
    "no-console": ["error", { allow: ["log"] }],
    // SAFETY: removing `undefined` args breaks required-nullable arity and Promise<undefined> returns.
    "typescript/no-floating-promises": "error",
    "unicorn/no-useless-undefined": "off",
  },
});
