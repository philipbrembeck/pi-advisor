/* SWE-bench control adapter. Test fixtures are prepared before inference and are never applied after it. */
/* biome-ignore-all lint/style/useBlockStatements: git lifecycle operations are kept compact and phase-oriented. */
/* biome-ignore-all lint/performance/noAwaitInLoops: protected-path checks must be deterministic and ordered. */
/* biome-ignore-all lint/performance/useTopLevelRegex: patch parsing patterns are local to canonical payload handling. */
/* biome-ignore-all lint/suspicious/useAwait: cleanup and subprocess boundaries intentionally await best-effort operations. */
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: setup and validation phases remain explicit and auditable. */
/* biome-ignore-all lint/complexity/useSimplifiedLogicExpression: setup guards preserve distinct failure causes. */
/* biome-ignore-all lint/style/useErrorCause: setup errors retain subprocess messages and failure categories at the benchmark boundary. */

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { hashJson } from "../src/isolation.js";
import type { RawBenchmarkResult, RunSpec } from "../src/types.js";
import type {
  EnvironmentFingerprint,
  ModelPatchTelemetry,
  PreparedWorkspace,
  RepositoryEnvironment,
  SwebenchManifest,
  SwebenchRunRecord,
  SwebenchTask,
  SwebenchValidation,
  WorkspaceState,
} from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 4000;
const cachePromises = new Map<string, Promise<string>>();

export class BenchmarkSetupError extends Error {
  readonly category = "benchmark-setup-failure" as const;
}
export class RuntimeConfigurationError extends Error {
  readonly category = "benchmark-runtime-configuration-failure" as const;
}

const REPOSITORY_ADAPTER_VERSION = "2026-08-19.3";
export const repositoryAdapter = (
  repo: string
): import("./types.js").SwebenchRepository => {
  if (repo === "django/django") return "django";
  if (repo === "matplotlib/matplotlib") return "matplotlib";
  if (repo === "scikit-learn/scikit-learn") return "scikit-learn";
  if (repo === "sphinx-doc/sphinx") return "sphinx";
  if (repo === "sympy/sympy") return "sympy";
  if (existsSync(repo)) return "local";
  throw new BenchmarkSetupError(`unsupported SWE-bench repository: ${repo}`);
};

const environmentPackages: Record<
  import("./types.js").SwebenchRepository,
  string[]
> = {
  django: ["setuptools==65.7.0", "wheel", "asgiref", "pytz", "sqlparse"],
  local: [],
  matplotlib: [
    "setuptools==65.7.0",
    "wheel",
    "pytest<9",
    "numpy==1.23.5",
    "pillow",
    "kiwisolver==1.3.1",
    "cycler==0.10.0",
    "python-dateutil==2.7.0",
    "pyparsing==2.3.1",
    "contourpy==1.0.1",
    "fonttools>=4.30",
    "pybind11>=2.6",
    "setuptools_scm>=7",
    "setuptools-scm-git-archive",
    "certifi",
    "packaging",
  ],
  "scikit-learn": [
    "setuptools==65.7.0",
    "wheel",
    "pytest<9",
    "numpy==1.23.5",
    "scipy<1.11",
    "joblib",
    "threadpoolctl",
    "Cython==0.29.37",
    "pandas==1.5.3",
  ],
  sphinx: [
    "setuptools==65.7.0",
    "wheel",
    "pytest<8",
    "pytest-cov",
    "html5lib",
    "typed-ast",
    "Cython<3",
    "Jinja2<3.1",
    "docutils<0.18",
    "Pygments<3",
    "snowballstemmer",
    "babel",
    "alabaster<0.8",
    "imagesize",
    "requests",
    "packaging",
    "sphinxcontrib-applehelp<1.0.5",
    "sphinxcontrib-devhelp<1.0.3",
    "sphinxcontrib-jsmath<1.0.2",
    "sphinxcontrib-htmlhelp<2.0",
    "sphinxcontrib-serializinghtml<1.1.5",
    "sphinxcontrib-qthelp<1.0.4",
  ],
  sympy: ["setuptools==65.7.0", "wheel", "pytest<9", "mpmath==1.3.0"],
};

const sha256 = (value: string | Buffer) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const summarize = (value: string) =>
  value.length > MAX_OUTPUT ? `${value.slice(0, MAX_OUTPUT)}…` : value;
const shell = async (cwd: string, args: string[]) => {
  try {
    return await execFileAsync("git", args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    const detail = error as {
      message?: string;
      stdout?: string;
      stderr?: string;
    };
    throw new Error(
      `git ${args.join(" ")} failed: ${detail.stderr || detail.stdout || detail.message || String(error)}`,
      { cause: error }
    );
  }
};

export const loadManifest = (path: string): SwebenchManifest => {
  const value = JSON.parse(
    readFileSync(resolve(path), "utf8")
  ) as SwebenchManifest;
  if (
    value.schemaVersion !== 1 ||
    !value.experimentId ||
    !Array.isArray(value.tasks) ||
    ![5, 20].includes(value.tasks.length)
  ) {
    throw new TypeError(
      "SWE-bench manifest must contain exactly five or twenty pinned tasks."
    );
  }
  for (const task of value.tasks) {
    if (
      !task.baseCommit ||
      !task.repo ||
      !task.testPatchSha256.startsWith("sha256:") ||
      !task.solutionPatchSha256.startsWith("sha256:") ||
      !task.testPatch ||
      !task.solutionPatch ||
      !task.validation.program ||
      !Array.isArray(task.validation.args)
    ) {
      throw new TypeError(`Incomplete canonical task payload: ${task.id}`);
    }
    if (sha256(task.testPatch) !== task.testPatchSha256) {
      throw new TypeError(`Canonical test patch hash mismatch: ${task.id}`);
    }
    if (sha256(task.solutionPatch) !== task.solutionPatchSha256) {
      throw new TypeError(`Canonical solution patch hash mismatch: ${task.id}`);
    }
  }
  return value;
};

const treeHash = (root: string): string => {
  const hash = createHash("sha256");
  const visit = (dir: string, relative = "") => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".git") continue;
      const absolute = join(dir, name);
      const rel = relative ? `${relative}/${name}` : name;
      const info = lstatSync(absolute);
      hash.update(rel).update("\0").update(String(info.mode)).update("\0");
      if (info.isDirectory()) visit(absolute, rel);
      else if (info.isSymbolicLink())
        hash.update(readFileSync(absolute)).update("\0");
      else if (info.isFile()) hash.update(readFileSync(absolute)).update("\0");
    }
  };
  visit(resolve(root));
  return `sha256:${hash.digest("hex")}`;
};

export const canonicalPatchFiles = (patch: string): string[] => {
  const paths = new Set<string>();
  for (const line of patch.split("\n")) {
    if (!line.startsWith("diff --git a/")) continue;
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (match) {
      paths.add(match[1]);
      paths.add(match[2]);
    }
  }
  return [...paths].sort();
};

const sphinxPackageForVersion = (item: string, version: string) => {
  if (item.startsWith("alabaster")) {
    if (version === "3.1") return "alabaster<0.7.14";
    return "alabaster<0.8";
  }
  if (item.startsWith("sphinxcontrib-serializinghtml")) {
    if (version === "3.1") return "sphinxcontrib-serializinghtml<1.1.4";
    return "sphinxcontrib-serializinghtml";
  }
  if (item.startsWith("sphinxcontrib-htmlhelp")) {
    if (version === "3.1") return "sphinxcontrib-htmlhelp<1.0.3";
    if (version.startsWith("4.")) return "sphinxcontrib-htmlhelp<2.1";
    return "sphinxcontrib-htmlhelp";
  }
  if (item.startsWith("docutils")) {
    if (version === "3.4") return "docutils==0.16";
    return item;
  }
  return item;
};

const setupEnvironment = async (
  task: SwebenchTask,
  workspace: string,
  cacheRoot: string
): Promise<RepositoryEnvironment> => {
  const adapter = repositoryAdapter(task.repo);
  let packages = [...environmentPackages[adapter]];
  if (adapter === "sphinx") {
    const versionSource = readFileSync(
      join(workspace, "sphinx", "__init__.py"),
      "utf8"
    );
    const version =
      /__version__\s*=\s*['"](\d+\.\d+)/.exec(versionSource)?.[1] ?? "unknown";
    if (version === "3.1") {
      packages = packages.map((item) => sphinxPackageForVersion(item, version));
    } else if (version.startsWith("4.") || version.startsWith("5.")) {
      packages = packages.map((item) => sphinxPackageForVersion(item, version));
      packages = packages.filter((item) => !item.startsWith("docutils<0.18"));
      packages.push("docutils<0.20");
    }
  }
  const requestedPython =
    process.env.PI_SWEBENCH_PYTHON ??
    ((adapter === "matplotlib" || adapter === "scikit-learn") &&
    process.arch === "arm64" &&
    existsSync("/opt/homebrew/bin/python3.11")
      ? "/opt/homebrew/bin/python3.11"
      : "python3");
  const provisionFingerprint = sha256(
    JSON.stringify({ adapter, packages, python: requestedPython })
  );
  const environmentRoot = join(
    resolve(cacheRoot),
    "environments",
    provisionFingerprint.slice(-32)
  );
  const python = join(environmentRoot, "bin", "python");
  const marker = join(environmentRoot, "environment.json");
  mkdirSync(dirname(environmentRoot), { recursive: true });
  let setupCommand = "environment already provisioned";
  let setupOutput = { stderrSummary: "", stdoutSummary: "" };
  let markerValue: {
    adapter?: string;
    adapterVersion?: string;
    installedPackages?: string[];
    packages?: string[];
    python?: string;
  } = {};
  if (existsSync(marker)) {
    try {
      markerValue = JSON.parse(
        readFileSync(marker, "utf8")
      ) as typeof markerValue;
    } catch {
      markerValue = {};
    }
  }
  const markerMatches =
    markerValue.adapter === adapter &&
    markerValue.adapterVersion === REPOSITORY_ADAPTER_VERSION &&
    JSON.stringify(markerValue.packages) === JSON.stringify(packages) &&
    markerValue.python === requestedPython &&
    Array.isArray(markerValue.installedPackages);
  if (!markerMatches || !existsSync(python)) {
    rmSync(environmentRoot, { force: true, recursive: true });
    try {
      await execFileAsync(
        "uv",
        ["venv", "--python", requestedPython, environmentRoot],
        {
          maxBuffer: 2 * 1024 * 1024,
        }
      );
      setupCommand = `uv pip install --python ${python} ${packages.join(" ")}`;
      const installed = await execFileAsync(
        "uv",
        ["pip", "install", "--python", python, ...packages],
        { maxBuffer: 20 * 1024 * 1024 }
      );
      setupOutput = {
        stderrSummary: summarize(installed.stderr ?? ""),
        stdoutSummary: summarize(installed.stdout ?? ""),
      };
    } catch (error) {
      const detail = error as {
        message?: string;
        stdout?: string;
        stderr?: string;
      };
      throw new BenchmarkSetupError(
        `environment setup failed for ${task.id}: ${detail.stderr || detail.stdout || detail.message || String(error)}`,
        { cause: error }
      );
    }
    writeFileSync(
      marker,
      JSON.stringify(
        {
          adapter,
          adapterVersion: REPOSITORY_ADAPTER_VERSION,
          installedPackages: (
            await execFileAsync("uv", ["pip", "freeze", "--python", python], {
              maxBuffer: 4 * 1024 * 1024,
            })
          ).stdout
            .split("\n")
            .filter(Boolean)
            .sort(),
          packages,
          python: requestedPython,
        },
        null,
        2
      )
    );
    markerValue = JSON.parse(
      readFileSync(marker, "utf8")
    ) as typeof markerValue;
  }
  const installedPackages = markerValue.installedPackages ?? [];
  const environmentFingerprint = sha256(
    JSON.stringify({
      adapter,
      installedPackages,
      packages,
      python: requestedPython,
    })
  );
  const variables: Record<string, string> = {
    MPLBACKEND: "Agg",
    OMP_NUM_THREADS: "1",
    OPENBLAS_NUM_THREADS: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONPATH: workspace,
    PYTHONWARNINGS: "default",
  };
  const build =
    adapter === "matplotlib" || adapter === "scikit-learn"
      ? { args: ["setup.py", "build_ext", "--inplace"], program: python }
      : undefined;
  if (adapter === "matplotlib") {
    variables.CFLAGS = "-DByte=uint8_t";
    variables.SETUPTOOLS_SCM_PRETEND_VERSION = "0.0.0";
  }
  if (adapter === "scikit-learn") variables.SKLEARN_NO_OPENMP = "1";
  return {
    adapter,
    adapterVersion: REPOSITORY_ADAPTER_VERSION,
    build,
    buildSource: workspace,
    environmentFingerprint,
    installedPackages,
    python,
    setupCommand,
    setupOutput,
    variables,
  };
};

const ensureCache = async (
  repo: string,
  cacheRoot: string,
  baseCommit: string
) => {
  const key = `${cacheRoot}:${repo}`;
  const existing = cachePromises.get(key);
  if (existing) return existing;
  const promise = (async () => {
    mkdirSync(cacheRoot, { recursive: true });
    const cache = join(cacheRoot, sha256(repo).slice(-32));
    const source =
      repo.includes("://") || repo.startsWith("/") || repo.startsWith(".")
        ? repo
        : `https://github.com/${repo}.git`;
    if (!existsSync(join(cache, "HEAD"))) {
      await execFileAsync("git", ["clone", "--bare", source, cache], {
        maxBuffer: 2 * 1024 * 1024,
      });
    }
    await execFileAsync("git", ["fetch", "--quiet", "origin", baseCommit], {
      cwd: cache,
      maxBuffer: 2 * 1024 * 1024,
    });
    return cache;
  })();
  cachePromises.set(key, promise);
  return promise;
};

const commitState = async (workspace: string): Promise<WorkspaceState> => {
  const { stdout } = await shell(workspace, ["rev-parse", "HEAD"]);
  return { commit: stdout.trim(), treeHash: treeHash(workspace) };
};

export const prepareWorkspace = async (
  task: SwebenchTask,
  cacheRoot: string
): Promise<PreparedWorkspace> => {
  const root = mkdtempSync(join(tmpdir(), "pi-swebench-"));
  const workspace = join(root, "workspace");
  const patchPath = join(root, "test.patch");
  try {
    const cache = await ensureCache(task.repo, cacheRoot, task.baseCommit);
    await execFileAsync(
      "git",
      [
        "clone",
        "--quiet",
        "--no-local",
        "--reference",
        cache,
        cache,
        workspace,
      ],
      {
        maxBuffer: 2 * 1024 * 1024,
      }
    );
    await shell(workspace, ["config", "core.hooksPath", "/dev/null"]);
    await shell(workspace, [
      "fetch",
      "--quiet",
      "--no-tags",
      "origin",
      task.baseCommit,
    ]);
    await shell(workspace, [
      "checkout",
      "--quiet",
      "--detach",
      task.baseCommit,
    ]);
    const base = await commitState(workspace);
    if (base.commit !== task.baseCommit) {
      throw new BenchmarkSetupError(
        `base commit mismatch: ${base.commit} != ${task.baseCommit}`
      );
    }
    writeFileSync(patchPath, task.testPatch);
    try {
      await shell(workspace, ["apply", "--check", patchPath]);
      await shell(workspace, ["apply", "--whitespace=nowarn", patchPath]);
    } catch (error) {
      throw new BenchmarkSetupError(
        `canonical test patch cannot apply: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
    const testFiles = canonicalPatchFiles(task.testPatch);
    // `git diff` omits files introduced by a test patch until they are staged.
    // Stage before comparing so new canonical test fixtures are not silently lost.
    await shell(workspace, ["add", "-A"]);
    const actualFiles = (
      await shell(workspace, [
        "diff",
        "--cached",
        "--name-only",
        task.baseCommit,
      ])
    ).stdout
      .split("\n")
      .filter(Boolean)
      .sort();
    if (
      JSON.stringify(actualFiles) !==
      JSON.stringify([...new Set(testFiles)].sort())
    ) {
      throw new BenchmarkSetupError(
        `canonical test file set mismatch for ${task.id}`
      );
    }
    const environment = await setupEnvironment(task, workspace, cacheRoot);
    await shell(workspace, ["commit", "--quiet", "-m", "benchmark-prepared"]);
    const prepared = await commitState(workspace);
    return {
      base,
      cleanup: () => rmSync(root, { force: true, recursive: true }),
      environment,
      prepared,
      root,
      testFiles,
      testPatchHash: task.testPatchSha256,
      workspace,
    };
  } catch (error) {
    rmSync(root, { force: true, recursive: true });
    if (error instanceof BenchmarkSetupError) throw error;
    throw new BenchmarkSetupError(
      error instanceof Error ? error.message : String(error),
      { cause: error }
    );
  }
};

const pathExistsInCommit = async (
  workspace: string,
  commit: string,
  path: string
) => {
  try {
    await shell(workspace, ["cat-file", "-e", `${commit}:${path}`]);
    return true;
  } catch {
    return false;
  }
};

export const protectedTestChanges = async (
  workspace: string,
  preparedCommit: string,
  testFiles: string[]
) => {
  const changed: string[] = [];
  for (const path of testFiles) {
    const inCommit = await pathExistsInCommit(workspace, preparedCommit, path);
    const exists = existsSync(join(workspace, path));
    let different = false;
    if (inCommit) {
      try {
        await shell(workspace, ["diff", "--quiet", preparedCommit, "--", path]);
      } catch {
        different = true;
      }
    } else if (exists) {
      different = true;
    }
    if (different || (inCommit && !exists)) changed.push(path);
  }
  return changed.sort();
};

const diffStats = (patch: string) => {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) linesAdded += 1;
    if (line.startsWith("-")) linesRemoved += 1;
  }
  return { linesAdded, linesRemoved };
};

export const captureModelPatch = async (
  prepared: PreparedWorkspace,
  artifactPath: string
): Promise<ModelPatchTelemetry> => {
  await shell(prepared.workspace, ["add", "-A"]);
  const patch = (
    await shell(prepared.workspace, [
      "diff",
      "--cached",
      "--binary",
      prepared.prepared.commit,
    ])
  ).stdout;
  const filesChanged = (
    await shell(prepared.workspace, [
      "diff",
      "--cached",
      "--name-only",
      prepared.prepared.commit,
    ])
  ).stdout
    .split("\n")
    .filter(Boolean)
    .sort();
  const testFilesChanged = filesChanged.filter((path) =>
    prepared.testFiles.includes(path)
  );
  const productionFilesChanged = filesChanged.filter(
    (path) => !prepared.testFiles.includes(path)
  );
  const stats = diffStats(patch);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, patch);
  return {
    artifactPath,
    diffBytes: Buffer.byteLength(patch),
    filesChanged,
    linesAdded: stats.linesAdded,
    linesRemoved: stats.linesRemoved,
    patchSha256: sha256(patch),
    productionFilesChanged,
    protectedTestMutation: testFilesChanged.length > 0,
    testFilesChanged,
  };
};

const productionPatch = async (
  prepared: PreparedWorkspace,
  files: string[]
) => {
  if (!files.length) return "";
  return (
    await shell(prepared.workspace, [
      "diff",
      "--cached",
      "--binary",
      prepared.prepared.commit,
      "--",
      ...files,
    ])
  ).stdout;
};

export const createCanonicalValidationWorkspace = async (
  prepared: PreparedWorkspace,
  _task: SwebenchTask,
  patch: string
) => {
  const validation = join(
    prepared.root,
    `validation-${Math.random().toString(16).slice(2)}`
  );
  await shell(prepared.workspace, [
    "worktree",
    "add",
    "--quiet",
    "--detach",
    validation,
    prepared.prepared.commit,
  ]);
  try {
    if (patch) {
      const patchPath = join(prepared.root, "model-production.patch");
      writeFileSync(patchPath, patch);
      await shell(validation, ["apply", "--check", patchPath]);
      await shell(validation, ["apply", "--whitespace=nowarn", patchPath]);
    }
    return {
      cleanup: async () => {
        await shell(prepared.workspace, [
          "worktree",
          "remove",
          "--force",
          validation,
        ]).catch(() => undefined);
      },
      path: validation,
    };
  } catch (error) {
    await shell(prepared.workspace, [
      "worktree",
      "remove",
      "--force",
      validation,
    ]).catch(() => undefined);
    throw new BenchmarkSetupError(
      `model production patch cannot be replayed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
};

export const validateTaskState = async (
  workspace: string,
  task: SwebenchTask,
  timeoutSeconds: number,
  environment?: RepositoryEnvironment
): Promise<SwebenchValidation> => {
  const program =
    task.validation.program === "python3"
      ? (environment?.python ?? task.validation.program)
      : task.validation.program;
  const commandEnvironment = {
    ...(environment?.variables ?? {}),
    PYTHONPATH:
      [
        workspace,
        environment?.adapter === "matplotlib" ? join(workspace, "lib") : "",
        environment?.variables.PYTHONPATH,
      ]
        .filter(Boolean)
        .join(":") || ".",
  };
  let args: string[];
  try {
    args = validationArgs(task, workspace);
  } catch (error) {
    return {
      command: "selector translation",
      durationMs: 0,
      exitCode: null,
      failureReason: error instanceof Error ? error.message : String(error),
      passed: false,
      stderrSummary: error instanceof Error ? error.message : String(error),
      stdoutSummary: "",
      timedOut: false,
    };
  }
  const validationCommand = [program, ...args].join(" ");
  if (environment?.build) {
    if (environment.buildSource && environment.buildSource !== workspace)
      copyBuildArtifacts(environment.buildSource, workspace);
    const buildResult = await runCommand(
      environment.build.program,
      environment.build.args,
      workspace,
      timeoutSeconds,
      commandEnvironment
    );
    if (buildResult.timedOut || buildResult.exitCode !== 0) {
      return {
        command: `${[environment.build.program, ...environment.build.args].join(" ")} && ${validationCommand}`,
        durationMs: buildResult.durationMs,
        exitCode: buildResult.exitCode,
        ...(buildResult.signal ? { signal: buildResult.signal } : {}),
        failureReason: buildResult.error ?? "repository extension build failed",
        passed: false,
        stderrSummary: summarize(buildResult.stderr),
        stdoutSummary: summarize(buildResult.stdout),
        timedOut: buildResult.timedOut,
      };
    }
  }
  const result = await runCommand(
    program,
    args,
    workspace,
    timeoutSeconds,
    commandEnvironment
  );
  return {
    command: environment?.build
      ? `${[environment.build.program, ...environment.build.args].join(" ")} && ${validationCommand}`
      : validationCommand,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    ...(result.signal ? { signal: result.signal } : {}),
    stderrSummary: summarize(result.stderr),
    stdoutSummary: summarize(result.stdout),
    ...(result.error ? { failureReason: result.error } : {}),
    passed: !result.timedOut && result.exitCode === 0,
    timedOut: result.timedOut,
  };
};

export const normalizePytestSelector = (selector: string) => {
  if (!selector.includes("::")) return selector;
  const parameterStart = selector.indexOf("[");
  return parameterStart >= 0 && !selector.endsWith("]")
    ? selector.slice(0, parameterStart)
    : selector;
};

const pytestValidationArgs = (task: SwebenchTask, workspace: string) => {
  if (!task.validation.args.includes("pytest")) return task.validation.args;
  const fileArgs = task.validation.args.filter((arg) =>
    existsSync(join(workspace, arg))
  );
  const selectors = [...new Set([...task.failToPass, ...task.passToPass])];
  const resolved = selectors.map((selector) => {
    const normalized = normalizePytestSelector(selector);
    if (normalized.includes("::")) return normalized;
    const escaped = selector.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
    const matches = fileArgs.filter((file) =>
      new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?def\\s+${escaped}\\s*\\(`).test(
        readFileSync(join(workspace, file), "utf8")
      )
    );
    if (matches.length !== 1) {
      throw new BenchmarkSetupError(
        `cannot resolve pytest selector ${selector} for ${task.id}`
      );
    }
    return `${matches[0]}::${selector}`;
  });
  const firstFile = task.validation.args.findIndex((arg) =>
    fileArgs.includes(arg)
  );
  if (firstFile < 0) {
    throw new BenchmarkSetupError(
      `pytest file selector missing for ${task.id}`
    );
  }
  return [...task.validation.args.slice(0, firstFile), ...resolved];
};

const validationArgs = (task: SwebenchTask, workspace: string) =>
  task.validation.program === "python3"
    ? pytestValidationArgs(task, workspace)
    : task.validation.args;

const copyBuildArtifacts = (source: string, target: string) => {
  const copy = (from: string, relative = "") => {
    for (const name of readdirSync(from)) {
      const absolute = join(from, name);
      const rel = relative ? join(relative, name) : name;
      const info = lstatSync(absolute);
      if (info.isDirectory()) {
        if (rel === "build") {
          cpSync(absolute, join(target, rel), { force: true, recursive: true });
        } else copy(absolute, rel);
        continue;
      }
      if (!info.isFile() || !/\.(?:a|c|cpp|dylib|o|so)$/.test(name)) continue;
      const destination = join(target, rel);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(absolute, destination, { force: true });
    }
  };
  copy(source);
};

const runCommand = (
  program: string,
  args: string[],
  cwd: string,
  timeoutSeconds: number,
  env: Record<string, string>
) =>
  new Promise<{
    durationMs: number;
    error?: string;
    exitCode: number | null;
    signal?: string;
    stderr: string;
    stdout: string;
    timedOut: boolean;
  }>((resolveResult) => {
    const started = Date.now();
    const child = spawn(program, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutSeconds * 1000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveResult({
        durationMs: Date.now() - started,
        error: error.message,
        exitCode: null,
        stderr,
        stdout,
        timedOut,
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolveResult({
        durationMs: Date.now() - started,
        exitCode,
        ...(signal ? { signal } : {}),
        stderr,
        stdout,
        timedOut,
      });
    });
  });

export const validateModelState = async (
  prepared: PreparedWorkspace,
  task: SwebenchTask,
  modelPatch: ModelPatchTelemetry,
  timeoutSeconds: number
) => {
  const patch = await productionPatch(
    prepared,
    modelPatch.productionFilesChanged
  );
  const validation = await createCanonicalValidationWorkspace(
    prepared,
    task,
    patch
  );
  try {
    return await validateTaskState(
      validation.path,
      task,
      timeoutSeconds,
      prepared.environment
    );
  } finally {
    await validation.cleanup();
  }
};

export const validateGoldState = async (
  prepared: PreparedWorkspace,
  task: SwebenchTask,
  timeoutSeconds: number
) => {
  const patchPath = join(prepared.root, "solution.patch");
  writeFileSync(patchPath, task.solutionPatch);
  const validation = await createCanonicalValidationWorkspace(
    prepared,
    task,
    task.solutionPatch
  );
  try {
    return await validateTaskState(
      validation.path,
      task,
      timeoutSeconds,
      prepared.environment
    );
  } finally {
    await validation.cleanup();
  }
};

export const validateInitialState = (
  prepared: PreparedWorkspace,
  task: SwebenchTask,
  timeoutSeconds: number
) =>
  validateTaskState(
    prepared.workspace,
    task,
    timeoutSeconds,
    prepared.environment
  );

export const assertModelIdentity = (resolved: string, piModel: string) => {
  const id = resolved.includes("/")
    ? resolved.slice(resolved.indexOf("/") + 1)
    : resolved;
  if (piModel !== id) {
    throw new RuntimeConfigurationError(
      `PI_MODEL=${piModel} disagrees with resolved executor ${resolved}`
    );
  }
};

export const environmentFingerprint = (input: {
  task: SwebenchTask;
  prepared: PreparedWorkspace;
  resolvedModel: string;
  piModel: string;
  provider: string;
  apiType: string;
  reasoningConfiguration: string;
  effectiveProviderSettings?: Record<string, unknown>;
  timeoutSeconds: number;
  toolDefinitionsHash: string;
  systemPromptHash: string;
}): EnvironmentFingerprint => ({
  adapter: repositoryAdapter(input.task.repo),
  adapterVersion: REPOSITORY_ADAPTER_VERSION,
  apiType: input.apiType,
  architecture: arch(),
  baseCommit: input.prepared.base.commit,
  effectiveProviderSettings: input.effectiveProviderSettings ?? {},
  environmentFingerprint: input.prepared.environment.environmentFingerprint,
  os: platform(),
  piModel: input.piModel,
  preparedWorkspaceHash: input.prepared.prepared.treeHash,
  pristineWorkspaceHash: input.prepared.base.treeHash,
  provider: input.provider,
  reasoningConfiguration: input.reasoningConfiguration,
  repository: input.task.repo,
  resolvedModel: input.resolvedModel,
  runtime: {
    bun: process.versions.bun ?? "unknown",
    node: process.versions.node,
    python: "python3 (validator-reported)",
  },
  systemPromptHash: input.systemPromptHash,
  testPatchHash: input.prepared.testPatchHash,
  timeoutSeconds: input.timeoutSeconds,
  toolDefinitionsHash: input.toolDefinitionsHash,
});

export const normalizedFingerprint = (value: EnvironmentFingerprint) => {
  const {
    piModel: _piModel,
    provider: _provider,
    resolvedModel: _resolvedModel,
    ...modelIndependent
  } = value;
  return modelIndependent;
};

export const classifyRun = (input: {
  setupError?: boolean;
  runtimeConfigurationError?: boolean;
  providerError?: boolean;
  timedOut?: boolean;
  validationPassed?: boolean;
  settled?: boolean;
}): SwebenchRunRecord["primaryCategory"] => {
  if (input.setupError) return "benchmark-setup-failure";
  if (input.runtimeConfigurationError)
    return "benchmark-runtime-configuration-failure";
  if (input.providerError) return "provider-failure";
  if (input.timedOut) return "model-timeout";
  if (input.validationPassed && input.settled) return "success";
  return "model-validation-failure";
};

export const failureIsScorable = (
  category: SwebenchRunRecord["primaryCategory"]
) =>
  category === "success" ||
  category === "model-validation-failure" ||
  category === "model-timeout";

export const toWorkerTask = (
  task: SwebenchTask,
  prepared: PreparedWorkspace
) => ({
  category: "debugging" as const,
  fixtureHash: prepared.prepared.treeHash,
  fixturePath: prepared.workspace,
  id: task.id,
  prompt: `${task.problemStatement}\n\nImplement the requested fix in this repository. Do not modify benchmark test files. Run relevant tests and leave the workspace with the production fix applied.`,
  taskHash: sha256(JSON.stringify(task)),
  validation: { args: [], program: "tests/runtests.py" },
  validatorHash: sha256(task.validation.program),
  validatorPath: resolve(prepared.workspace, task.validation.program),
});

export const workerSpec = (
  task: SwebenchTask,
  prepared: PreparedWorkspace,
  base: Omit<RunSpec, "task" | "workspacePath">
): RunSpec => ({
  ...base,
  task: toWorkerTask(task, prepared),
  workspacePath: prepared.workspace,
});

export interface WorkerPayload {
  error?: string;
  result?: RawBenchmarkResult;
}
export const runWorker = (
  spec: RunSpec,
  timeoutMs: number
): Promise<WorkerPayload> =>
  new Promise((resolveResult) => {
    const child = spawn(
      process.execPath,
      [new URL("../src/worker.ts", import.meta.url).pathname],
      {
        cwd: resolve("."),
        detached: true,
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: spec.agentDir,
          PI_MODEL: spec.expectedModels.executor.slice(
            spec.expectedModels.executor.indexOf("/") + 1
          ),
          PI_PROVIDER: spec.expectedModels.executor.slice(
            0,
            spec.expectedModels.executor.indexOf("/")
          ),
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const kill = (signal: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          /* child exited */
        }
      }
      child.kill(signal);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 500).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveResult({ error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut)
        return resolveResult({
          error: `worker timed out after ${timeoutMs}ms`,
        });
      if (code !== 0)
        return resolveResult({
          error: stderr.slice(-2000) || `worker exited ${code}`,
        });
      try {
        resolveResult(JSON.parse(stdout.trim().split("\n").at(-1) ?? ""));
      } catch (error) {
        resolveResult({
          error: `malformed worker output: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
    child.stdin.end(JSON.stringify(spec));
  });

export const hashToolAndPrompt = (result: RawBenchmarkResult) => ({
  systemPromptHash: result.runtime?.effectiveSystemPromptHash ?? "missing",
  toolDefinitionsHash: hashJson(result.runtime?.toolDefinitions ?? []),
});
