/* Orchestration for the pinned five-task SWE-bench control. */
/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: each benchmark failure boundary remains explicit and auditable. */
/* biome-ignore-all lint/performance/noBarrelFile: the CLI intentionally exposes the adapter command surface from one runner module. */
/* biome-ignore-all lint/style/useDestructuring: lifecycle state is intentionally accessed by phase. */
/* biome-ignore-all lint/style/useNumericSeparators: experiment seed matches the frozen historical control identity. */
/* biome-ignore-all lint/style/useBlockStatements: lifecycle branches remain explicit. */
/* biome-ignore-all lint/performance/noAwaitInLoops: preflight and bounded control scheduling are intentionally ordered. */
/* biome-ignore-all lint/suspicious/noUnnecessaryConditions: worker termination guards are explicit lifecycle sentinels. */
/* biome-ignore-all lint/suspicious/noAssignInExpressions: the bounded worker index is claimed atomically. */
/* biome-ignore-all lint/style/noIncrementDecrement: the bounded worker index is a local scheduler counter. */
/* biome-ignore-all lint/performance/useTopLevelRegex: phase-local patterns are intentionally close to their diagnostics. */
/* biome-ignore-all assist/source/useSortedKeys: result fields follow lifecycle rather than lexical ordering. */
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadBenchmarkConfig } from "../src/config.js";
import { hashJson, hashText } from "../src/isolation.js";
import type { RawBenchmarkResult, RunSpec } from "../src/types.js";
import {
  assertModelIdentity,
  BenchmarkSetupError,
  captureModelPatch,
  classifyRun,
  environmentFingerprint,
  failureIsScorable,
  normalizedFingerprint,
  prepareWorkspace,
  protectedTestChanges,
  repositoryAdapter,
  runWorker,
  validateGoldState,
  validateInitialState,
  validateModelState,
  validateTaskState,
  workerSpec,
} from "./adapter.js";
import type {
  EnvironmentFingerprint,
  PreflightPhase,
  PreflightRow,
  SwebenchManifest,
  SwebenchRunRecord,
  SwebenchTask,
  SwebenchValidation,
} from "./types.js";

const DEFAULT_CACHE = "benchmarks/swebench/cache";
const DEFAULT_ARTIFACTS = "benchmarks/swebench/artifacts";
const EMPTY_STATE = { commit: "unavailable", treeHash: "unavailable" };
const EMPTY_PATCH = (path: string) => ({
  artifactPath: path,
  diffBytes: 0,
  filesChanged: [],
  linesAdded: 0,
  linesRemoved: 0,
  patchSha256: hashText(""),
  productionFilesChanged: [],
  protectedTestMutation: false,
  testFilesChanged: [],
});
const emptyFingerprint = (task: SwebenchTask): EnvironmentFingerprint => ({
  adapter: repositoryAdapter(task.repo),
  adapterVersion: "unavailable",
  apiType: "unavailable",
  architecture: process.arch,
  baseCommit: task.baseCommit,
  effectiveProviderSettings: {},
  environmentFingerprint: "unavailable",
  os: process.platform,
  piModel: "unavailable",
  preparedWorkspaceHash: "unavailable",
  pristineWorkspaceHash: "unavailable",
  provider: "unavailable",
  reasoningConfiguration: "unavailable",
  repository: task.repo,
  resolvedModel: "unavailable",
  runtime: {
    bun: process.versions.bun ?? "unknown",
    node: process.versions.node,
    python: "unknown",
  },
  systemPromptHash: "unavailable",
  testPatchHash: task.testPatchSha256,
  timeoutSeconds: 0,
  toolDefinitionsHash: "unavailable",
});

const configForRun = (
  configPath: string,
  task: SwebenchTask,
  preparedRoot: string,
  model: string,
  mode: "sol" | "luna" | "luna-advisor-optional"
) => {
  const loaded = loadBenchmarkConfig(configPath);
  const providerIndex = model.indexOf("/");
  const provider = model.slice(0, providerIndex);
  const id = model.slice(providerIndex + 1);
  const agentDir = join(preparedRoot, "agent");
  mkdirSync(agentDir, { recursive: true });
  const configPathForAgent = join(agentDir, "advisor.json");
  writeFileSync(
    configPathForAgent,
    JSON.stringify({
      advisorAutoLoopGate: false,
      advisorCompletionGate: false,
      advisorFailureGate: false,
      advisorGitContext: "off",
      advisorMaxCallsPerSession: mode === "luna-advisor-optional" ? 4 : 0,
      advisorPlanGate: false,
      advisorRedactSecrets: true,
      advisorScoutEnabled: false,
      advisorSessionSummary: false,
      alwaysOn: false,
      ...(mode === "luna-advisor-optional"
        ? { advisor: "openai-codex/gpt-5.6-sol" }
        : {}),
      executor: model,
    })
  );
  return {
    agentDir,
    config: loaded.config,
    configFileHash: loaded.hash,
    configPath: configPathForAgent,
    expectedModels: { executor: model },
    id,
    provider,
    task,
  };
};

const runSpec = (
  configPath: string,
  task: SwebenchTask,
  preparedRoot: string,
  prepared: Awaited<ReturnType<typeof prepareWorkspace>>,
  model: string,
  repetition: number,
  experimentId: string,
  mode: "sol" | "luna" | "luna-advisor-optional"
): RunSpec => {
  const setup = configForRun(configPath, task, preparedRoot, model, mode);
  return workerSpec(task, prepared, {
    agentDir: setup.agentDir,
    authPath: join(getAgentDir(), "auth.json"),
    benchmarkConfigFileHash: setup.configFileHash,
    benchmarkConfigHash: hashJson({ experimentId, mode, model, task: task.id }),
    config: setup.config,
    configPath: setup.configPath,
    expectedModels:
      mode === "luna-advisor-optional"
        ? { advisor: "openai-codex/gpt-5.6-sol", executor: model }
        : setup.expectedModels,
    mode,
    modelsPath: join(getAgentDir(), "models.json"),
    repetition,
    runId: randomUUID(),
    runKey: hashJson({ experimentId, mode, model, repetition, task: task.id }),
    seed: 20260818,
    telemetryToken: randomUUID(),
  });
};

const fingerprintFromResult = (
  result: RawBenchmarkResult,
  task: SwebenchTask,
  prepared: Awaited<ReturnType<typeof prepareWorkspace>>,
  timeoutSeconds: number
): EnvironmentFingerprint => {
  const runtime = result.runtime;
  const prompt = (runtime?.effectiveSystemPrompt ?? "")
    .replace(/\/[^\s"'`]+/g, "<path>")
    .replace(/gpt-5\.6-(?:sol|luna)/g, "gpt-5.6-<model>");
  const providerSettings = runtime?.providerRequestFields.at(-1) ?? {};
  return environmentFingerprint({
    apiType: runtime?.modelCapabilities.api ?? "unavailable",
    effectiveProviderSettings: providerSettings,
    piModel: runtime?.environmentVariables.PI_MODEL ?? "unavailable",
    prepared,
    provider: runtime?.modelCapabilities.provider ?? "unavailable",
    reasoningConfiguration: runtime?.reasoningEffort ?? "unavailable",
    resolvedModel: runtime?.resolvedModel ?? "unavailable",
    systemPromptHash: hashText(prompt),
    task,
    timeoutSeconds,
    toolDefinitionsHash: hashJson(runtime?.toolDefinitions ?? []),
  });
};

const validationForFailure = (reason: string): SwebenchValidation => ({
  command: "not-run",
  durationMs: 0,
  exitCode: null,
  failureReason: reason,
  passed: false,
  stderrSummary: reason,
  stdoutSummary: "",
  timedOut: false,
});

const rawMetrics = (result?: RawBenchmarkResult) => {
  const roles = result ? [result.executor, result.advisor, result.scout] : [];
  const cost =
    roles.length &&
    roles.every(
      (role) =>
        role.invocationStatus === "inactive" || role.configuredCost !== null
    )
      ? roles.reduce((sum, role) => sum + (role.configuredCost ?? 0), 0)
      : (result?.totalCost ?? null);
  const sumKnown = (field: "input" | "cacheRead" | "output" | "totalTokens") =>
    roles.every((role) => role[field] !== null)
      ? roles.reduce((sum, role) => sum + (role[field] ?? 0), 0)
      : null;
  const providerCost = roles.every((role) => role.providerCost !== null)
    ? roles.reduce((sum, role) => sum + (role.providerCost ?? 0), 0)
    : null;
  return {
    agentTurns: result?.trajectory?.agentTurns ?? 0,
    cost,
    durationMs: result?.durationMs ?? 0,
    modelCalls: result?.trajectory?.modelCalls ?? 0,
    toolCalls: result?.trajectory?.toolCalls ?? 0,
    inputTokens: sumKnown("input"),
    cachedInputTokens: sumKnown("cacheRead"),
    outputTokens: sumKnown("output"),
    totalTokens: sumKnown("totalTokens"),
    providerCost,
  };
};

const usageForResult = (result: RawBenchmarkResult) => ({
  executor: result.executor,
  advisor: result.advisor,
  scout: result.scout,
});

export const runOne = async (input: {
  artifactsRoot?: string;
  cacheRoot?: string;
  configPath: string;
  experimentId: string;
  model: "sol" | "luna" | "luna-advisor-optional";
  repetition: number;
  task: SwebenchTask;
  timeoutSeconds: number;
  validatorTimeoutSeconds: number;
}): Promise<SwebenchRunRecord> => {
  const started = Date.now();
  const executionId = randomUUID();
  const modelRef =
    input.model === "sol"
      ? "openai-codex/gpt-5.6-sol"
      : "openai-codex/gpt-5.6-luna";
  const artifactPath = join(
    input.artifactsRoot ?? DEFAULT_ARTIFACTS,
    input.experimentId,
    input.task.id,
    input.model,
    `repetition-${input.repetition}.patch`
  );
  let prepared: Awaited<ReturnType<typeof prepareWorkspace>> | undefined;
  try {
    prepared = await prepareWorkspace(
      input.task,
      input.cacheRoot ?? DEFAULT_CACHE
    );
    const spec = runSpec(
      input.configPath,
      input.task,
      prepared.root,
      prepared,
      modelRef,
      input.repetition,
      input.experimentId,
      input.model
    );
    const payload = await runWorker(spec, input.timeoutSeconds * 1000 + 5000);
    const result = payload.result;
    const modelPatch = await captureModelPatch(prepared, artifactPath);
    const protectedChanges = await protectedTestChanges(
      prepared.workspace,
      prepared.prepared.commit,
      prepared.testFiles
    );
    modelPatch.protectedTestMutation = protectedChanges.length > 0;
    modelPatch.testFilesChanged = [
      ...new Set([...modelPatch.testFilesChanged, ...protectedChanges]),
    ].sort();
    if (!result) {
      const runtimeConfigurationError = (payload.error ?? "").includes(
        "benchmark-runtime-configuration-failure"
      );
      const providerError =
        /provider|authentication|quota|rate limit|429/i.test(
          payload.error ?? ""
        );
      const category = classifyRun({
        providerError,
        runtimeConfigurationError,
        timedOut: /timed out/i.test(payload.error ?? ""),
      });
      return {
        base: prepared.base,
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        environmentFingerprint: emptyFingerprint(input.task),
        error: payload.error,
        executionId,
        experimentId: input.experimentId,
        instanceId: input.task.instanceId,
        metrics: rawMetrics(),
        mode: input.model,
        model: modelRef,
        modelPatch,
        piModel: "unavailable",
        prepared: prepared.prepared,
        primaryCategory: category,
        provider: "unavailable",
        providerConfiguration: {
          declared: { samplingParams: {}, temperature: 0 },
          effective: [],
          sampling: "provider-controlled",
        },
        repetition: input.repetition,
        resolvedModel: "unavailable",
        schemaVersion: 1,
        scorable: failureIsScorable(category),
        success: false,
        taskId: input.task.id,
        termination: {
          error: payload.error,
          state: category === "model-timeout" ? "timeout" : "worker-error",
        },
        testFiles: prepared.testFiles,
        testPatchHash: prepared.testPatchHash,
        validation: validationForFailure(
          payload.error ?? "worker did not produce a result"
        ),
      };
    }
    const runtime = result.runtime;
    const resolvedModel =
      runtime?.resolvedModel ??
      result.modelIds.resolved.executor ??
      "unavailable";
    const piModel = runtime?.environmentVariables.PI_MODEL ?? "unavailable";
    try {
      assertModelIdentity(resolvedModel, piModel);
    } catch (error) {
      const category = "benchmark-runtime-configuration-failure" as const;
      return {
        base: prepared.base,
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        environmentFingerprint: fingerprintFromResult(
          result,
          input.task,
          prepared,
          input.timeoutSeconds
        ),
        error: error instanceof Error ? error.message : String(error),
        executionId,
        experimentId: input.experimentId,
        instanceId: input.task.instanceId,
        metrics: rawMetrics(result),
        mode: input.model,
        model: modelRef,
        modelPatch,
        piModel,
        prepared: prepared.prepared,
        usage: usageForResult(result),
        trajectoryEvents: result.trajectoryEvents,
        primaryCategory: category,
        provider: runtime?.modelCapabilities.provider ?? "unavailable",
        providerConfiguration: {
          declared: { samplingParams: {}, temperature: 0 },
          effective: runtime?.providerRequestFields ?? [],
          sampling: runtime?.providerRequestFields.some(
            (fields) => fields.temperature !== undefined
          )
            ? "transmitted"
            : "provider-controlled",
        },
        repetition: input.repetition,
        resolvedModel,
        runtime,
        schemaVersion: 1,
        scorable: false,
        success: false,
        taskId: input.task.id,
        termination: {
          error: error instanceof Error ? error.message : String(error),
          state: "worker-error",
        },
        testFiles: prepared.testFiles,
        testPatchHash: prepared.testPatchHash,
        validation: validationForFailure(
          "benchmark-runtime-configuration-failure"
        ),
      };
    }
    let validation = validationForFailure("model did not settle");
    if (result.termination.state === "settled") {
      validation = await validateModelState(
        prepared,
        input.task,
        modelPatch,
        input.validatorTimeoutSeconds
      );
    }
    const category = classifyRun({
      providerError: result.termination.state === "provider-error",
      settled: result.termination.state === "settled",
      timedOut: result.termination.state === "timeout",
      validationPassed: validation.passed,
    });
    const fingerprint = fingerprintFromResult(
      result,
      input.task,
      prepared,
      input.timeoutSeconds
    );
    return {
      base: prepared.base,
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      environmentFingerprint: fingerprint,
      executionId,
      experimentId: input.experimentId,
      instanceId: input.task.instanceId,
      metrics: rawMetrics(result),
      mode: input.model,
      model: modelRef,
      modelPatch,
      piModel,
      prepared: prepared.prepared,
      primaryCategory: category,
      usage: usageForResult(result),
      trajectoryEvents: result.trajectoryEvents,
      provider: runtime?.modelCapabilities.provider ?? "unavailable",
      providerConfiguration: {
        declared: { samplingParams: {}, temperature: 0 },
        effective: runtime?.providerRequestFields ?? [],
        sampling: runtime?.providerRequestFields.some(
          (fields) => fields.temperature !== undefined
        )
          ? "transmitted"
          : "provider-controlled",
      },
      repetition: input.repetition,
      resolvedModel,
      runtime,
      schemaVersion: 1,
      scorable: failureIsScorable(category),
      success: category === "success",
      taskId: input.task.id,
      termination: {
        state: result.termination.state,
        ...(result.termination.error
          ? { error: result.termination.error }
          : {}),
      },
      testFiles: prepared.testFiles,
      testPatchHash: prepared.testPatchHash,
      validation,
    };
  } catch (error) {
    const category =
      error instanceof BenchmarkSetupError
        ? ("benchmark-setup-failure" as const)
        : ("benchmark-runtime-configuration-failure" as const);
    return {
      base: prepared?.base ?? EMPTY_STATE,
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      environmentFingerprint: prepared
        ? emptyFingerprint(input.task)
        : emptyFingerprint(input.task),
      error: error instanceof Error ? error.message : String(error),
      executionId,
      experimentId: input.experimentId,
      instanceId: input.task.instanceId,
      metrics: rawMetrics(),
      mode: input.model,
      model: modelRef,
      modelPatch: prepared
        ? await captureModelPatch(prepared, artifactPath)
        : EMPTY_PATCH(artifactPath),
      piModel: "unavailable",
      prepared: prepared?.prepared ?? EMPTY_STATE,
      primaryCategory: category,
      provider: "unavailable",
      providerConfiguration: {
        declared: { samplingParams: {}, temperature: 0 },
        effective: [],
        sampling: "provider-controlled",
      },
      repetition: input.repetition,
      resolvedModel: "unavailable",
      schemaVersion: 1,
      scorable: false,
      success: false,
      taskId: input.task.id,
      termination: {
        error: error instanceof Error ? error.message : String(error),
        state: "setup-error",
      },
      testFiles: input.task.testFiles,
      testPatchHash: input.task.testPatchSha256,
      validation: validationForFailure(
        error instanceof Error ? error.message : String(error)
      ),
    };
  } finally {
    prepared?.cleanup();
  }
};

const phase = (
  input: Partial<PreflightPhase> & { command: string }
): PreflightPhase => ({
  command: input.command,
  durationMs: input.durationMs ?? 0,
  exitCode: input.exitCode ?? (input.passed ? 0 : null),
  ...(input.exception ? { exception: input.exception } : {}),
  ...(input.failureClass ? { failureClass: input.failureClass } : {}),
  passed: input.passed ?? false,
  stderrSummary: input.stderrSummary ?? "",
  stdoutSummary: input.stdoutSummary ?? "",
  timedOut: input.timedOut ?? false,
});

const failureClass = (message: string): string => {
  if (
    /openmp|compile|cython|clang|gcc|native|not been built correctly|_check_build|_c_internal_utils/i.test(
      message
    )
  )
    return "native-build-failure";
  if (
    /No module named|ModuleNotFoundError|could not import|dependency/i.test(
      message
    )
  )
    return "dependency-missing";
  if (/canonical test file set mismatch|test patch/i.test(message))
    return "test-patch-apply";
  if (/gold|solution patch|production patch/i.test(message))
    return "gold-patch-apply";
  if (
    /invalid command|file or directory not found|no tests ran|cannot import name/i.test(
      message
    )
  )
    return "test-command-invalid";
  if (/timed out|timeout/i.test(message)) return "timeout";
  return "unknown";
};

const validationPhase = (
  validation: Awaited<ReturnType<typeof validateTaskState>>
): PreflightPhase =>
  phase({
    command: validation.command,
    durationMs: validation.durationMs,
    exitCode: validation.exitCode,
    ...(validation.failureReason
      ? { exception: validation.failureReason }
      : {}),
    ...(validation.passed
      ? {}
      : {
          failureClass: failureClass(
            `${validation.stderrSummary} ${validation.stdoutSummary}`
          ),
        }),
    passed: validation.passed,
    stderrSummary: validation.stderrSummary,
    stdoutSummary: validation.stdoutSummary,
    timedOut: validation.timedOut,
  });

const preflightRow = async (
  task: SwebenchTask,
  cacheRoot: string,
  validatorTimeoutSeconds: number
): Promise<PreflightRow> => {
  const phases = {
    checkout: phase({
      command: `git checkout --detach ${task.baseCommit}`,
      passed: false,
    }),
    environment: phase({
      command: "repository adapter environment setup",
      passed: false,
    }),
    goldPatch: phase({ command: "git apply --check <canonical-gold.patch>" }),
    goldValidation: phase({ command: "not-run" }),
    initial: phase({ command: "not-run" }),
    reverted: phase({ command: "not-run" }),
    testPatch: phase({
      command: "git apply --check <canonical-test.patch>",
      passed: false,
    }),
  };
  let prepared: Awaited<ReturnType<typeof prepareWorkspace>> | undefined;
  try {
    prepared = await prepareWorkspace(task, cacheRoot);
    phases.checkout = phase({
      command: `git checkout --detach ${task.baseCommit}`,
      durationMs: 0,
      passed: true,
    });
    phases.testPatch = phase({
      command: "git apply --whitespace=nowarn < canonical-test.patch",
      passed: true,
    });
    phases.environment = phase({
      command: prepared.environment.setupCommand,
      passed: true,
      stderrSummary: prepared.environment.setupOutput.stderrSummary,
      stdoutSummary: prepared.environment.setupOutput.stdoutSummary,
    });
    phases.initial = validationPhase(
      await validateInitialState(prepared, task, validatorTimeoutSeconds)
    );
    const gold = await validateGoldState(
      prepared,
      task,
      validatorTimeoutSeconds
    );
    phases.goldPatch = phase({
      command: "git apply --whitespace=nowarn < canonical-gold.patch",
      passed: true,
    });
    phases.goldValidation = validationPhase(gold);
    phases.reverted = validationPhase(
      await validateTaskState(
        prepared.workspace,
        task,
        validatorTimeoutSeconds,
        prepared.environment
      )
    );
    const row: PreflightRow = {
      adapter: prepared.environment.adapter,
      adapterVersion: prepared.environment.adapterVersion,
      base: "PASS",
      environment: prepared.environment.environmentFingerprint,
      environmentFingerprint: "COMPLETE",
      gold: phases.goldValidation.passed ? "PASS" : "FAIL",
      initial: phases.initial.passed ? "PASS" : "FAIL",
      phases,
      ready:
        phases.initial.passed === false &&
        phases.goldValidation.passed &&
        phases.reverted.passed === false,
      repo: task.repo,
      repositoryPath: prepared.workspace,
      reverted: phases.reverted.passed ? "PASS" : "FAIL",
      taskId: task.id,
      testPatch: "PASS",
    };
    return row;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = failureClass(message);
    let target = phases.checkout;
    if (prepared) {
      target = phases.initial;
      if (message.includes("environment")) target = phases.environment;
      else if (
        message.includes("gold") ||
        message.includes("production patch")
      ) {
        target = phases.goldPatch;
      }
    } else if (message.includes("canonical test")) {
      target = phases.testPatch;
    }
    target.exception = message;
    target.failureClass = failed;
    target.stderrSummary = message;
    target.passed = false;
    return {
      adapter: prepared?.environment.adapter ?? repositoryAdapter(task.repo),
      adapterVersion: prepared?.environment.adapterVersion ?? "unavailable",
      base: phases.checkout.passed ? "PASS" : "FAIL",
      environment: prepared?.environment.environmentFingerprint,
      environmentFingerprint: prepared ? "COMPLETE" : "INCOMPLETE",
      error: message,
      gold: "FAIL",
      initial: "FAIL",
      phases,
      ready: false,
      repo: task.repo,
      repositoryPath: prepared?.workspace,
      reverted: "FAIL",
      taskId: task.id,
      testPatch: phases.testPatch.passed ? "PASS" : "FAIL",
    };
  } finally {
    prepared?.cleanup();
  }
};

export const runPreflight = async (
  manifest: SwebenchManifest,
  cacheRoot = DEFAULT_CACHE,
  validatorTimeoutSeconds = 300
) => {
  const rows: PreflightRow[] = [];
  for (const task of manifest.tasks)
    rows.push(await preflightRow(task, cacheRoot, validatorTimeoutSeconds));
  return rows;
};

export const assertPreflight = (rows: PreflightRow[]) => {
  const bad = rows.filter(
    (row) =>
      row.base !== "PASS" ||
      row.testPatch !== "PASS" ||
      row.initial !== "FAIL" ||
      row.gold !== "PASS" ||
      row.reverted !== "FAIL" ||
      row.environmentFingerprint !== "COMPLETE"
  );
  if (bad.length)
    throw new Error(
      `SWE-bench preflight failed: ${bad.map((row) => `${row.taskId}: ${row.error ?? "state mismatch"}`).join("; ")}`
    );
};

export const renderPreflight = (rows: PreflightRow[]) =>
  [
    "| Task | Base | Test Patch | Initial | Gold | Reverted | Environment Fingerprint |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.taskId.replace("django-django-", "")} | ${row.base} | ${row.testPatch} | ${row.initial} | ${row.gold} | ${row.reverted} | ${row.environmentFingerprint} |`
    ),
  ].join("\n");

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const runRuntimeProbe = async (input: {
  manifest: SwebenchManifest;
  configPath: string;
  cacheRoot?: string;
  timeoutSeconds: number;
}) => {
  const task = input.manifest.tasks[0];
  const fingerprints: Record<string, EnvironmentFingerprint> = {};
  for (const model of ["sol", "luna"] as const) {
    const prepared = await prepareWorkspace(
      task,
      input.cacheRoot ?? DEFAULT_CACHE
    );
    try {
      const spec = runSpec(
        input.configPath,
        task,
        prepared.root,
        prepared,
        model === "sol"
          ? "openai-codex/gpt-5.6-sol"
          : "openai-codex/gpt-5.6-luna",
        0,
        input.manifest.experimentId,
        model
      );
      const payload = await runWorker(spec, input.timeoutSeconds * 1000 + 5000);
      if (!payload.result)
        throw new Error(
          `${model} probe failed: ${payload.error ?? "no result"}`
        );
      fingerprints[model] = fingerprintFromResult(
        payload.result,
        task,
        prepared,
        input.timeoutSeconds
      );
      assertModelIdentity(
        fingerprints[model].resolvedModel,
        fingerprints[model].piModel
      );
    } finally {
      prepared.cleanup();
    }
  }
  const sol = normalizedFingerprint(fingerprints.sol);
  const luna = normalizedFingerprint(fingerprints.luna);
  if (stableJson(sol) !== stableJson(luna))
    throw new Error(
      "Sol/Luna runtime probe differs outside intended model identity fields"
    );
  return { equivalent: true, fingerprints, normalized: sol };
};

export const runControl = async (input: {
  manifest: SwebenchManifest;
  configPath: string;
  resultsPath: string;
  artifactsRoot?: string;
  cacheRoot?: string;
  concurrency: number;
  timeoutSeconds: number;
  validatorTimeoutSeconds: number;
}) => {
  if (existsSync(input.resultsPath))
    throw new Error(
      `Refusing to overwrite existing results: ${input.resultsPath}`
    );
  mkdirSync(resolve(input.resultsPath, ".."), { recursive: true });
  const entries = input.manifest.tasks.flatMap((task) =>
    (["sol", "luna"] as const).flatMap((model) =>
      Array.from({ length: 3 }, (_, repetition) => ({
        model,
        repetition,
        task,
      }))
    )
  );
  const records: SwebenchRunRecord[] = [];
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= entries.length) return;
      const entry = entries[index];
      const record = await runOne({
        artifactsRoot: input.artifactsRoot,
        cacheRoot: input.cacheRoot,
        configPath: input.configPath,
        experimentId: input.manifest.experimentId,
        model: entry.model,
        repetition: entry.repetition,
        task: entry.task,
        timeoutSeconds: input.timeoutSeconds,
        validatorTimeoutSeconds: input.validatorTimeoutSeconds,
      });
      records.push(record);
      appendFileSync(input.resultsPath, `${JSON.stringify(record)}\n`);
      process.stdout.write(
        `[swebench-control] ${records.length}/${entries.length} ${entry.task.id} ${entry.model} ${entry.repetition} ${record.primaryCategory}\n`
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(input.concurrency, entries.length) }, worker)
  );
  return records;
};

export const readSwebenchResults = (path: string) =>
  readFileSync(resolve(path), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SwebenchRunRecord);
