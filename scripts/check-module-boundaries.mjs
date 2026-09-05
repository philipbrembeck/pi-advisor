import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";

const sourceRoot = resolve("src");
const facadePaths = new Set(
  ["config.ts", "ui.ts", "tools.ts", "commands.ts"].map((file) =>
    resolve(sourceRoot, file)
  )
);

const collectTypeScriptFiles = (directory) => {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(path));
    } else if (entry.isFile() && extname(entry.name) === ".ts") {
      files.push(path);
    }
  }
  return files;
};

const moduleSpecifiers = (source) => {
  const specifiers = [];
  const staticImportPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImportPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(staticImportPattern)) {
    specifiers.push({ index: match.index ?? 0, specifier: match[1] });
  }
  for (const match of source.matchAll(dynamicImportPattern)) {
    specifiers.push({ index: match.index ?? 0, specifier: match[1] });
  }
  return specifiers;
};

const resolveRelativeSpecifier = (importer, specifier) => {
  if (!(specifier.startsWith("./") || specifier.startsWith("../"))) {
    return null;
  }
  let path = resolve(dirname(importer), specifier);
  if (extname(path) === ".js") {
    path = `${path.slice(0, -3)}.ts`;
  } else if (!extname(path)) {
    path = `${path}.ts`;
  }
  return normalize(path);
};

const violations = [];
for (const importer of collectTypeScriptFiles(sourceRoot)) {
  if (facadePaths.has(importer)) {
    continue;
  }
  const source = readFileSync(importer, "utf8");
  for (const { specifier, index } of moduleSpecifiers(source)) {
    const resolved = resolveRelativeSpecifier(importer, specifier);
    if (!(resolved && facadePaths.has(resolved))) {
      continue;
    }
    const line = source.slice(0, index).split("\n").length;
    violations.push(
      `${importer}:${line} imports facade ${specifier}; import a config/UI/tools/commands leaf instead`
    );
  }
}

if (violations.length > 0) {
  throw new Error(
    `Module boundary violations detected:\n${violations.sort().join("\n")}`
  );
}

console.log(
  "Module boundaries verified: production leaves do not import facades."
);
