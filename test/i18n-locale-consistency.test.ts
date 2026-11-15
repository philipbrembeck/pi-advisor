import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from "node:path";

const repositoryRoot = join(import.meta.dirname, "..");

const collectFiles = (dir: string): string[] => {
  const entries: Dirent[] = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFiles(path));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }

  return files;
};

const sourceFiles = [
  ...collectFiles(join(repositoryRoot, "src")),
  ...collectFiles(join(repositoryRoot, "extensions")),
];

// Matches t("key", "fallback") and t('key', 'fallback') across line breaks.
// Delimiters must match pairwise so mixed quotes do not capture.
const tCallPattern =
  /\bt\(\s*(?<keyQuote>["'])(?<key>[^"']+)\k<keyQuote>\s*,\s*(?<fallbackQuote>["'])(?<fallback>(?:[^\\\n]|\\.)*?)\k<fallbackQuote>/gu;

const unquote = (literal: string, quote: string): string => {
  if (quote === '"') {
    // SAFETY: double-quoted literals in t() call sites are JSON-compatible strings.
    return JSON.parse(`"${literal}"`) as string;
  }

  return literal
    .replaceAll('\\n', "\n")
    .replaceAll('\\t', "\t")
    .replaceAll('\\\'', "'");
};

interface CallSite {
  fallback: string;
  file: string;
  key: string;
}

const readCallSites = (file: string): CallSite[] => {
  const source = readFileSync(file, "utf-8");
  const sites: CallSite[] = [];

  for (const match of source.matchAll(tCallPattern)) {
    const key = match.groups?.key;
    const fallback = match.groups?.fallback;
    const quote = match.groups?.fallbackQuote;

    if (!key || !fallback || !quote) {
      continue;
    }

    sites.push({
      fallback: unquote(fallback, quote),
      file: file.replace(`${repositoryRoot}/`, ""),
      key,
    });
  }

  return sites;
};

const callSites = sourceFiles.flatMap(readCallSites);

// SAFETY: locales/en.json is authored as a flat dotted key-to-string map.
const english = JSON.parse(
  readFileSync(join(repositoryRoot, "locales/en.json"), "utf-8")
) as Record<string, string>;

const usedKeys = new Set(callSites.map((site) => site.key));

const declaredKeys = new Set(
  Object.keys(english).filter((key) => !key.startsWith("_meta."))
);

describe("i18n locale consistency", () => {
  test("every t() call site is declared in locales/en.json with the exact fallback", () => {
    const problems: string[] = [];

    for (const site of callSites) {
      if (!(site.key in english)) {
        problems.push(
          `${site.file}: missing key "${site.key}" in locales/en.json`
        );
      } else if (english[site.key] !== site.fallback) {
        problems.push(
          `${site.file}: fallback for "${site.key}" differs from locales/en.json`
        );
      }
    }

    expect(problems).toEqual([]);
  });

  test("locales/en.json declares no unused keys", () => {
    const unused = [...declaredKeys].filter((key) => !usedKeys.has(key));

    expect(unused).toEqual([]);
  });

  test("at least fifty t() call sites exist", () => {
    expect(callSites.length).toBeGreaterThan(50);
  });
});
