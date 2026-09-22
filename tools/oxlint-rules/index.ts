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
  const {
    dependencies,
    devDependencies,
    optionalDependencies,
    peerDependencies,
  } = JSON.parse(readFileSync("package.json", "utf-8"));
  const fields = [
    dependencies,
    devDependencies,
    peerDependencies,
    optionalDependencies,
  ];
  return new Set(fields.flatMap((field) => Object.keys(field ?? {})));
};

/** Report bare imports of packages missing from package.json (phantom dependencies). */
export const noUndeclaredDependenciesRule = defineRule({
  createOnce(context) {
    let declared: Set<string> | undefined;
    const check = (node: ESTree.Node, specifier: string | undefined) => {
      if (specifier === undefined) {
        return;
      }
      const name = packageNameOf(specifier);
      if (name === null || RUNTIME_BUILTINS.has(name)) {
        return;
      }
      declared ??= declaredPackages();
      if (!declared.has(name)) {
        context.report({ data: { name }, messageId: "undeclared", node });
      }
    };
    return {
      ExportAllDeclaration: (node) => check(node, node.source?.value),
      ExportNamedDeclaration: (node) => check(node, node.source?.value),
      ImportDeclaration: (node) => check(node, node.source?.value),
      ImportExpression: (node) => {
        const { source } = node;
        if (source?.type !== "Literal") {
          return;
        }
        const { value } = source;
        check(node, value);
      },
    };
  },
  meta: {
    docs: {
      description:
        "Disallow importing packages that are not declared in package.json.",
    },
    messages: {
      undeclared:
        'Package "{{name}}" is imported but not declared in package.json.',
    },
    type: "problem",
  },
});

export default {
  rules: {
    "no-undeclared-dependencies": noUndeclaredDependenciesRule,
  },
};
