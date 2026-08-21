import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type BenchmarkCategory,
  type BenchmarkTaskManifest,
  CATEGORIES,
  type ResolvedTask,
} from "./types.js";

const TASK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf8"));
const validId = (value: unknown) =>
  typeof value === "string" && TASK_ID_PATTERN.test(value);

export const validateTaskManifest = (
  value: unknown,
  path = "task.json"
): BenchmarkTaskManifest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const task = value as Record<string, unknown>;
  if (!validId(task.id)) {
    throw new TypeError(`${path}.id must be a stable kebab-case identifier.`);
  }
  if (!CATEGORIES.includes(task.category as BenchmarkCategory)) {
    throw new TypeError(`${path}.category is invalid.`);
  }
  if (typeof task.fixture !== "string" || !task.fixture) {
    throw new TypeError(`${path}.fixture is required.`);
  }
  if (
    typeof task.prompt !== "string" ||
    task.prompt.trim().length < 10 ||
    task.prompt.length > 20_000
  ) {
    throw new TypeError(
      `${path}.prompt must be between 10 and 20000 characters.`
    );
  }
  if (
    !task.validation ||
    typeof task.validation !== "object" ||
    Array.isArray(task.validation)
  ) {
    throw new TypeError(`${path}.validation is required.`);
  }
  const validation = task.validation as Record<string, unknown>;
  if (typeof validation.program !== "string" || !validation.program) {
    throw new TypeError(`${path}.validation.program is required.`);
  }
  if (
    !Array.isArray(validation.args) ||
    validation.args.some((arg) => typeof arg !== "string")
  ) {
    throw new TypeError(`${path}.validation.args must be a string array.`);
  }
  for (const [key, raw] of [
    ["timeoutSeconds", task.timeoutSeconds],
    ["validation.timeoutSeconds", validation.timeoutSeconds],
  ] as const) {
    if (
      raw !== undefined &&
      (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0)
    ) {
      throw new TypeError(`${path}.${key} must be a positive integer.`);
    }
  }
  return value as unknown as BenchmarkTaskManifest;
};

export const loadTask = (manifestPath: string): ResolvedTask => {
  const absoluteManifest = resolve(manifestPath);
  const manifestText = readFileSync(absoluteManifest, "utf8");
  const value = readJson(absoluteManifest);
  const manifest = validateTaskManifest(value, absoluteManifest);
  const base = dirname(absoluteManifest);
  const fixturePath = resolve(base, manifest.fixture);
  const validatorPath = resolve(base, manifest.validation.program);
  if (!(existsSync(fixturePath) && statSync(fixturePath).isDirectory())) {
    throw new Error(
      `Fixture directory not found for ${manifest.id}: ${fixturePath}`
    );
  }
  if (!(existsSync(validatorPath) && statSync(validatorPath).isFile())) {
    throw new Error(`Validator not found for ${manifest.id}: ${validatorPath}`);
  }
  return {
    ...manifest,
    fixtureHash: hashTree(fixturePath),
    fixturePath,
    taskHash: `sha256:${createHash("sha256").update(manifestText).digest("hex")}`,
    validation: { ...manifest.validation, program: validatorPath },
    validatorHash: hashFile(validatorPath),
    validatorPath,
  };
};

const hashFile = (path: string) =>
  `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;

export const hashTree = (root: string): string => {
  const hash = createHash("sha256");
  const visit = (current: string, relative = "") => {
    for (const name of readdirSync(current).sort()) {
      const absolute = resolve(current, name);
      const rel = relative ? `${relative}/${name}` : name;
      const stats = statSync(absolute);
      if (stats.isDirectory()) {
        visit(absolute, rel);
      } else if (stats.isFile()) {
        hash
          .update(rel)
          .update("\0")
          .update(readFileSync(absolute))
          .update("\0");
      }
    }
  };
  visit(resolve(root));
  return `sha256:${hash.digest("hex")}`;
};

export const discoverTasks = (root: string): ResolvedTask[] => {
  const manifests: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = resolve(dir, name);
      if (statSync(path).isDirectory()) {
        visit(path);
      } else if (name === "task.json") {
        manifests.push(path);
      }
    }
  };
  visit(resolve(root));
  const tasks = manifests.map(loadTask);
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) {
      throw new Error(`Duplicate task ID: ${task.id}`);
    }
    ids.add(task.id);
  }
  return tasks.sort((a, b) => a.id.localeCompare(b.id));
};

export const selectTasks = (
  tasks: ResolvedTask[],
  filters: { ids?: string[]; category?: BenchmarkCategory }
) =>
  tasks.filter(
    (task) =>
      (!filters.ids?.length || filters.ids.includes(task.id)) &&
      (!filters.category || task.category === filters.category)
  );
