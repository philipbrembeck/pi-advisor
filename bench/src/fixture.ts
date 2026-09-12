import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type {
  DecisionItem,
  DecisionKey,
  DecisionTrap,
  ReplayFixture,
} from "./types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const hashFile = (path: string) =>
  `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;

/** Hashes relative names and bytes, so rename and content changes are visible. */
export const hashTree = (root: string): string => {
  const base = resolve(root);
  const hash = createHash("sha256");
  const visit = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const stats = lstatSync(path);
      const rel = relative(base, path).split("\\").join("/");
      if (stats.isDirectory()) {
        visit(path);
      } else if (stats.isFile()) {
        hash.update(rel).update("\0").update(readFileSync(path)).update("\0");
      } else if (stats.isSymbolicLink()) {
        hash
          .update(rel)
          .update("\0SYMLINK\0")
          .update(readFileSync(path, "utf8"));
      }
    }
  };
  visit(base);
  return `sha256:${hash.digest("hex")}`;
};

const TOML_LINE_PATTERN = /\r?\n/;
const TOML_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOML_NUMBER_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

const stripComment = (line: string) => {
  let quote = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"' && line[index - 1] !== "\\") {
      quote = !quote;
    }
    if (line[index] === "#" && !quote) {
      return line.slice(0, index);
    }
  }
  return line;
};

const parseTomlValue = (raw: string, path: string, lineNumber: number) => {
  if (raw.startsWith('"') || raw.startsWith("[")) {
    try {
      return JSON.parse(raw) as unknown;
    } catch (error) {
      throw new TypeError(`${path}:${lineNumber} has invalid TOML value.`, {
        cause: error,
      });
    }
  }
  if (raw === "true" || raw === "false") {
    return raw === "true";
  }
  if (TOML_NUMBER_PATTERN.test(raw)) {
    return Number(raw);
  }
  return raw;
};

const parseTomlLine = (line: string, path: string, lineNumber: number) => {
  const separator = line.indexOf("=");
  if (line.startsWith("[") || separator < 0) {
    throw new TypeError(`${path}:${lineNumber} must be a flat key/value.`);
  }
  const key = line.slice(0, separator).trim();
  const raw = line.slice(separator + 1).trim();
  if (!(TOML_KEY_PATTERN.test(key) && raw)) {
    throw new TypeError(`${path}:${lineNumber} has an invalid key/value.`);
  }
  return [key, parseTomlValue(raw, path, lineNumber)] as const;
};

/** Minimal TOML reader for the flat benchmark key files. */
export const parseFlatToml = (text: string, path = "fixture.toml") => {
  const result: Record<string, unknown> = {};
  for (const [index, original] of text.split(TOML_LINE_PATTERN).entries()) {
    const line = stripComment(original).trim();
    if (line) {
      const [key, value] = parseTomlLine(line, path, index + 1);
      result[key] = value;
    }
  }
  return result;
};

const requiredString = (value: unknown, name: string, path: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${path}.${name} must be a non-empty string.`);
  }
  return value;
};

const loadJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf8"));

export const loadReplayFixture = (path: string): ReplayFixture => {
  const value = loadJson(path);
  if (!isRecord(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const id = requiredString(value.id, "id", path);
  if (!isRecord(value.payload)) {
    throw new TypeError(`${path}.payload must be an object.`);
  }
  if (
    !Array.isArray(value.volatileFields) ||
    value.volatileFields.some((field) => typeof field !== "string")
  ) {
    throw new TypeError(`${path}.volatileFields must be a string array.`);
  }
  return {
    id,
    payload: value.payload,
    volatileFields: [...value.volatileFields],
    ...(value.gate === undefined ? {} : { gate: value.gate as never }),
  };
};

const parseKey = (
  value: Record<string, unknown>,
  path: string
): DecisionKey => {
  const { reasonTokens } = value;
  if (
    !Array.isArray(reasonTokens) ||
    reasonTokens.some((token) => typeof token !== "string")
  ) {
    throw new TypeError(`${path}.reasonTokens must be a string array.`);
  }
  return {
    defectClass: requiredString(value.defectClass, "defectClass", path),
    ...(value.findingId === undefined
      ? {}
      : { findingId: requiredString(value.findingId, "findingId", path) }),
    reasonTokens: [...reasonTokens],
    targetFile: requiredString(value.targetFile, "targetFile", path),
    targetSymbol: requiredString(value.targetSymbol, "targetSymbol", path),
  };
};

const parseTraps = (value: unknown, path: string): DecisionTrap[] => {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new TypeError(`${path}[${index}] must be an object.`);
    }
    const { tokens } = entry;
    if (
      !Array.isArray(tokens) ||
      tokens.some((token) => typeof token !== "string")
    ) {
      throw new TypeError(`${path}[${index}].tokens must be a string array.`);
    }
    return {
      choice: requiredString(entry.choice, "choice", `${path}[${index}]`),
      tokens: [...tokens],
    };
  });
};

const candidateBands = ["trivial", "candidate-uplift", "out-of-reach"] as const;
const isCandidateBand = (
  value: unknown
): value is (typeof candidateBands)[number] =>
  typeof value === "string" && candidateBands.includes(value as never);

export const loadDecisionItem = (directory: string): DecisionItem => {
  const root = resolve(directory);
  const itemPath = join(root, "item.toml");
  const item = parseFlatToml(readFileSync(itemPath, "utf8"), itemPath);
  const conversationPath = join(root, "conversation.json");
  const conversationValue = loadJson(conversationPath);
  const conversation =
    typeof conversationValue === "string"
      ? conversationValue
      : JSON.stringify(conversationValue);
  const draft = readFileSync(join(root, "draft.md"), "utf8");
  const answer = parseKey(
    parseFlatToml(
      readFileSync(join(root, "key", "answer.toml"), "utf8"),
      "answer.toml"
    ),
    "answer.toml"
  );
  const trapsToml = parseFlatToml(
    readFileSync(join(root, "key", "traps.toml"), "utf8"),
    "traps.toml"
  );
  const trapEntries =
    trapsToml.choices ??
    (trapsToml.choice === undefined
      ? []
      : [{ choice: trapsToml.choice, tokens: trapsToml.tokens }]);
  const traps = parseTraps(trapEntries, "traps.toml");
  const { band, polarity } = item;
  if (polarity !== "positive" && polarity !== "negative") {
    throw new TypeError(`${itemPath}.polarity must be positive or negative.`);
  }
  if (band !== undefined && !isCandidateBand(band)) {
    throw new TypeError(`${itemPath}.band must be a known candidate band.`);
  }
  const origin = requiredString(item.origin, "origin", itemPath);
  const reactBenchCommit =
    item.reactBenchCommit === undefined
      ? undefined
      : requiredString(item.reactBenchCommit, "reactBenchCommit", itemPath);
  const repoPath = join(root, "repo");
  if (!statSync(repoPath).isDirectory()) {
    throw new TypeError(`${repoPath} must be a directory.`);
  }
  return {
    ...(item.band === undefined ? {} : { band: item.band as never }),
    conversation,
    draft,
    id: requiredString(item.id, "id", itemPath),
    key: answer,
    polarity,
    provenance: { origin, ...(reactBenchCommit ? { reactBenchCommit } : {}) },
    repoPath,
    traps,
  };
};

export const discoverDecisionItems = (root: string): DecisionItem[] => {
  const base = resolve(root);
  const directories = readdirSync(base)
    .map((name) => join(base, name))
    .filter((path) => statSync(path).isDirectory())
    .sort();
  const items = directories.map(loadDecisionItem);
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new Error(`Duplicate decision item: ${item.id}`);
    }
    ids.add(item.id);
  }
  return items;
};
