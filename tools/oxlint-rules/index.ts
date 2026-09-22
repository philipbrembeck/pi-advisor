import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";

import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const RUNTIME_BUILTINS = new Set([
  ...builtinModules,
  "bun:test",
  "oxlint",
  "oxfmt",
]);

const packageNameOf = (specifier: string): string | null => {
  if (
    specifier.startsWith("node:") ||
    specifier.startsWith("bun:") ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#")
  ) {
    return null;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

const declaredPackages = (): Set<string> => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const fields = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];
  return new Set(fields.flatMap((field) => Object.keys(field ?? {})));
};

/** Report bare imports of packages missing from package.json (phantom dependencies). */
export const noUndeclaredDependenciesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing packages that are not declared in package.json.",
    },
    messages: {
      undeclared:
        'Package "{{name}}" is imported but not declared in package.json.',
    },
  },
  createOnce(context) {
    let declared: Set<string> | undefined;
    const check = (node: ESTree.Node, rawSpecifier: unknown) => {
      if (typeof rawSpecifier !== "string") {
        return;
      }
      const name = packageNameOf(rawSpecifier);
      if (name === null || RUNTIME_BUILTINS.has(name)) {
        return;
      }
      declared ??= declaredPackages();
      if (!declared.has(name)) {
        context.report({ node, messageId: "undeclared", data: { name } });
      }
    };
    return {
      ImportDeclaration: (node) => check(node, node.source?.value),
      ExportNamedDeclaration: (node) => check(node, node.source?.value),
      ExportAllDeclaration: (node) => check(node, node.source?.value),
      ImportExpression: (node) => {
        const source = node.source;
        if (source?.type === "Literal") {
          check(node, source.value);
        }
      },
    };
  },
});

export default {
  rules: {
    "no-undeclared-dependencies": noUndeclaredDependenciesRule,
  },
};
