#!/usr/bin/env node
// Merges locales/en.json keys into de.json / fr.json, preserving existing
// translations and listing keys that still need a translation.
import { readFileSync, writeFileSync } from "node:fs";

const read = (file) => JSON.parse(readFileSync(file, "utf-8"));
const english = read("locales/en.json");

for (const locale of ["de", "fr"]) {
  const path = `locales/${locale}.json`;
  let target = {};

  try {
    target = read(path);
  } catch {
    target = {
      "_meta.notes": `Translations for ${locale}. Missing keys fall back to English.`,
    };
  }

  const merged = { ...target };
  const untranslated = [];

  for (const [key, value] of Object.entries(english)) {
    if (key.startsWith("_meta.")) {
      continue;
    }
    if (merged[key] === undefined) {
      untranslated.push(key);
    }
  }

  const sorted = {};
  for (const key of Object.keys(merged).sort()) {
    sorted[key] = merged[key];
  }

  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`${locale}: ${untranslated.length} untranslated`);
  for (const key of untranslated) {
    console.log(`  ${key} = ${JSON.stringify(english[key])}`);
  }
}
