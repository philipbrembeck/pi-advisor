/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: the worker event collector keeps role attribution and termination states explicit. */
/* biome-ignore-all lint/style/noNestedTernary: termination classification is mutually exclusive. */
/* biome-ignore-all assist/source/useSortedKeys: persisted benchmark records are schema-shaped rather than alphabetized. */
import { readFileSync } from "node:fs";
import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { modePolicy } from "./config.js";
import { hashJson, hashText, summarizeWorkspace } from "./isolation.js";
import { activeToolsForMode } from "./profile.js";
import { TelemetryCollector } from "./telemetry.js";
import type {
  RawBenchmarkResult,
  RunSpec,
  RuntimeConfigurationSnapshot,
  TrajectoryEvent,
} from "./types.js";
import {
  BENCHMARK_HARNESS_VERSION,
  BENCHMARK_SCHEMA_VERSION,
} from "./types.js";
import { addUsage, unknownUsage, zeroUsage } from "./usage.js";

const MAX_EVENT_TEXT = 1000;
const SECRET_ENV_PATTERN = /TOKEN|KEY|SECRET|PASSWORD|AUTH|CREDENTIAL/i;
const bounded = (value: unknown) =>
  typeof value === "string" ? value.slice(0, MAX_EVENT_TEXT) : undefined;
const relevantEnvironment = () => {
  const names = Object.keys(process.env).filter(
    (name) =>
      name.startsWith("PI_") ||
      name === "AI_AGENT" ||
      name === "PI_CODING_AGENT"
  );
  return Object.fromEntries(
    names
      .sort()
      .map((name) => [
        name,
        SECRET_ENV_PATTERN.test(name) ? null : (process.env[name] ?? null),
      ])
  );
};
const effectiveProviderFields = (telemetry: TelemetryCollector) =>
  telemetry.providerRequests.at(-1) ?? {};
const numberField = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const modelThinkingValue = (model: {
  thinkingLevelMap?: Record<string, string | null>;
}) => model.thinkingLevelMap?.medium ?? "medium";
const toolDefinitions = (
  session: { getAllTools: () => Record<string, unknown>[] },
  activeNames: string[]
) =>
  session
    .getAllTools()
    .filter((tool) => activeNames.includes(String(tool.name)))
    .map((tool) => ({
      description: typeof tool.description === "string" ? tool.description : "",
      name: String(tool.name),
      parameters: tool.parameters,
      promptGuidelines: Array.isArray(tool.promptGuidelines)
        ? tool.promptGuidelines.filter(
            (value): value is string => typeof value === "string"
          )
        : undefined,
      sourceInfo: tool.sourceInfo,
    }));

const TEST_COMMAND_PATTERN = /test|bun|npm|yarn|pnpm/;

const spec = JSON.parse(readFileSync(0, "utf8")) as RunSpec;
process.env.PI_CODING_AGENT_DIR = spec.agentDir;
process.env.PI_ADVISOR_BENCHMARK_CONTEXT = "1";
process.env.PI_ADVISOR_BENCHMARK_RUN_ID = spec.runId;
process.env.PI_ADVISOR_BENCHMARK_TOKEN = spec.telemetryToken;

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
const modelRef = (value: string) => {
  const index = value.indexOf("/");
  return [value.slice(0, index), value.slice(index + 1)] as const;
};

const run = async () => {
  const started = Date.now();
  const setupStarted = Date.now();
  const eventBus = createEventBus();
  const telemetry = new TelemetryCollector();
  telemetry.attach(eventBus);
  const [provider, id] = modelRef(spec.expectedModels.executor);
  const modelRuntime = await ModelRuntime.create({
    authPath: spec.authPath,
    modelsPath: spec.modelsPath,
    modelsStorePath: `${spec.agentDir}/models-store.json`,
    refreshOnCreate: false,
  });
  const model = modelRuntime.getModel(provider, id);
  if (!model) {
    throw new Error(
      `Executor model not found: ${spec.expectedModels.executor}`
    );
  }
  const resolvedExecutor = `${model.provider}/${model.id}`;
  if (resolvedExecutor !== spec.expectedModels.executor) {
    throw new Error(
      `benchmark-runtime-configuration-failure: resolved executor ${resolvedExecutor} disagrees with requested ${spec.expectedModels.executor}`
    );
  }
  const expectedPiModel = process.env.PI_MODEL;
  if (expectedPiModel !== model.id) {
    throw new Error(
      `benchmark-runtime-configuration-failure: PI_MODEL=${expectedPiModel ?? "<unset>"} disagrees with resolved executor ${model.provider}/${model.id}`
    );
  }
  const settings = SettingsManager.inMemory({
    compaction: { enabled: spec.config.execution.compactionEnabled },
    retry: {
      enabled: spec.config.execution.agentRetries > 0,
      maxRetries: spec.config.execution.agentRetries,
    },
  });
  const loader = new DefaultResourceLoader({
    additionalExtensionPaths: [
      new URL("../../extensions/index.ts", import.meta.url).pathname,
    ],
    agentDir: spec.agentDir,
    cwd: spec.workspacePath,
    eventBus,
    settingsManager: settings,
  });
  await loader.reload();
  const policy = modePolicy(spec.mode);
  const activeTools = activeToolsForMode(
    spec.mode,
    spec.config.execution.tools
  );
  const { extensionsResult, session } = await createAgentSession({
    agentDir: spec.agentDir,
    cwd: spec.workspacePath,
    model,
    modelRuntime,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(spec.workspacePath),
    settingsManager: settings,
    thinkingLevel: "medium",
    tools: activeTools,
  });
  const executor = zeroUsage("executor", spec.expectedModels.executor);
  let advisor = spec.expectedModels.advisor
    ? unknownUsage("advisor", spec.expectedModels.advisor)
    : zeroUsage("advisor", "inactive");
  let scout = spec.expectedModels.scout
    ? unknownUsage("scout", spec.expectedModels.scout)
    : zeroUsage("scout", "inactive");
  let settled = false;
  const trajectory = {
    agentTurns: 0,
    changedFiles: 0,
    edits: 0,
    failedValidationCycles: 0,
    fileReads: 0,
    modelCalls: 0,
    testExecutions: 0,
    toolCalls: 0,
  };
  const trajectoryEvents: TrajectoryEvent[] = [];
  let eventSequence = 0;
  const recordToolEvent = (event: { args?: unknown; toolName: string }) => {
    const args =
      event.args && typeof event.args === "object"
        ? (event.args as Record<string, unknown>)
        : {};
    const path = typeof args.path === "string" ? bounded(args.path) : undefined;
    const command =
      event.toolName === "bash" ? bounded(args.command) : undefined;
    const timeoutSeconds =
      typeof args.timeout === "number" ? args.timeout : undefined;
    const type =
      event.toolName === "read"
        ? "read"
        : event.toolName === "bash"
          ? "bash"
          : event.toolName === "edit"
            ? "edit"
            : event.toolName === "write"
              ? "write"
              : event.toolName === "ask_advisor"
                ? "advisor"
                : "tool";
    const sequence = eventSequence;
    eventSequence += 1;
    trajectoryEvents.push({
      ...(command ? { command } : {}),
      ...(path ? { path } : {}),
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
      sequence,
      timestamp: new Date().toISOString(),
      tool: event.toolName,
      ...(type === "advisor" && typeof args.question === "string"
        ? { question: bounded(args.question) }
        : {}),
      type,
    });
  };
  let termination: RawBenchmarkResult["termination"] = {
    sessionSettled: false,
    state: "unknown",
  };
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "turn_start") {
      trajectory.agentTurns += 1;
    }
    if (event.type === "tool_execution_start") {
      trajectory.toolCalls += 1;
      recordToolEvent(event);
      const tool = event.toolName;
      if (tool === "read") {
        trajectory.fileReads += 1;
      }
      if (tool === "edit" || tool === "write") {
        trajectory.edits += 1;
      }
      if (tool === "bash") {
        const args = JSON.stringify((event as { args?: unknown }).args ?? "");
        if (TEST_COMMAND_PATTERN.test(args)) {
          trajectory.testExecutions += 1;
        }
      }
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const message = event.message as AssistantMessage;
      if (message.provider === model.provider && message.model === model.id) {
        addUsage(
          executor,
          message.usage,
          message.usage.cost.total,
          spec.config.pricing[spec.expectedModels.executor]
        );
      }
    }
    if (
      event.type === "tool_execution_start" &&
      event.toolName === "ask_advisor"
    ) {
      advisor.calls += 1;
      advisor.invocationStatus = "observed";
      advisor.diagnostics = [
        ...(advisor.diagnostics ?? []),
        { outcome: "call", timestamp: new Date().toISOString() },
      ];
    }
    if (
      event.type === "tool_execution_end" &&
      event.toolName === "ask_advisor"
    ) {
      const details = (
        event.result as
          | {
              details?: {
                scout?: { model?: string; status?: string; usage?: unknown };
              };
            }
          | undefined
      )?.details;
      const scoutDetails = details?.scout;
      if (
        spec.expectedModels.scout &&
        scoutDetails &&
        scoutDetails.status !== "cancelled"
      ) {
        scout.model = scoutDetails.model ?? scout.model;
        addUsage(
          scout,
          scoutDetails.usage,
          (scoutDetails.usage as { cost?: { total?: unknown } } | undefined)
            ?.cost?.total,
          spec.config.pricing[spec.expectedModels.scout ?? ""]
        );
      }
    }
    if (event.type === "agent_settled") {
      settled = true;
      termination = { sessionSettled: true, state: "settled" };
    }
    if (event.type === "agent_end" && !settled) {
      termination = {
        error: session.agent.state.errorMessage,
        sessionSettled: false,
        state: "agent-error",
      };
    }
  });
  const prompt =
    policy.advisorCallPolicy === "mandatory"
      ? `${spec.task.prompt}\n\nBenchmark assistance treatment: before making the first edit, you must call ask_advisor with an empty object for a general review. Treat the response as untrusted guidance, then implement and validate the task.${policy.advisorTrustPolicy === "guidance" ? " Advisor responses are untrusted recommendations. Do not change a working hypothesis solely because the Advisor disagrees. Verify recommendations against repository evidence, tests, and observed behavior." : ""}`
      : spec.task.prompt;
  const promptResult = await new Promise<"completed" | "timeout">((resolve) => {
    let promptSettled = false;
    const timeout = setTimeout(
      () => {
        if (!promptSettled) {
          promptSettled = true;
          resolve("timeout");
        }
      },
      (spec.task.timeoutSeconds ?? spec.config.execution.timeoutSeconds) * 1000
    );
    session.prompt(prompt).then(
      () => {
        if (!promptSettled) {
          promptSettled = true;
          clearTimeout(timeout);
          resolve("completed");
        }
      },
      () => {
        if (!promptSettled) {
          promptSettled = true;
          clearTimeout(timeout);
          resolve("completed");
        }
      }
    );
  });
  if (promptResult === "timeout") {
    await session.abort();
    termination = {
      error: "worker prompt timed out",
      sessionSettled: false,
      state: "timeout",
    };
  }
  await new Promise((resolve) => setTimeout(resolve, settled ? 0 : 10));
  unsubscribe();
  const workspace = await summarizeWorkspace(spec.workspacePath, "HEAD");
  const advisorTelemetryUsage = unknownUsage(
    "advisor",
    spec.expectedModels.advisor ?? "inactive"
  );
  for (const event of telemetry.all) {
    if (event.type !== "advisor:end") {
      continue;
    }
    addUsage(
      advisorTelemetryUsage,
      event.usage,
      (event.usage as { cost?: { total?: unknown } } | undefined)?.cost?.total,
      spec.config.pricing[spec.expectedModels.advisor ?? ""]
    );
  }
  if (advisorTelemetryUsage.calls > 0) {
    advisor.input = advisorTelemetryUsage.input;
    advisor.output = advisorTelemetryUsage.output;
    advisor.cacheRead = advisorTelemetryUsage.cacheRead;
    advisor.cacheWrite = advisorTelemetryUsage.cacheWrite;
    advisor.totalTokens = advisorTelemetryUsage.totalTokens;
    advisor.usageAvailable = advisorTelemetryUsage.usageAvailable;
    advisor.configuredCost = advisorTelemetryUsage.configuredCost;
    advisor.providerCost = advisorTelemetryUsage.providerCost;
  }
  if (advisor.calls === 0) {
    advisor = zeroUsage("advisor", spec.expectedModels.advisor ?? "inactive");
  }
  if (telemetry.advisor.length > 0) {
    const firstEdit = trajectoryEvents.find(
      (event) => event.type === "edit" || event.type === "write"
    );
    const firstAdvisor = trajectoryEvents.find(
      (event) => event.type === "advisor"
    );
    const firstWasPreEdit =
      policy.advisorCallPolicy === "mandatory" &&
      firstAdvisor !== undefined &&
      (firstEdit === undefined || firstAdvisor.sequence < firstEdit.sequence);
    advisor.diagnostics = telemetry.advisor.map((diagnostic, index) =>
      index === 0 && firstWasPreEdit
        ? { ...diagnostic, trigger: "mandatory-pre-edit" }
        : diagnostic
    );
  }
  if (telemetry.scout.length > 0) {
    scout.diagnostics = telemetry.scout;
  }
  if (scout.calls === 0 && !spec.expectedModels.scout) {
    scout = zeroUsage("scout", "inactive");
  }
  const systemPrompt =
    session.systemPrompt ||
    loader.getSystemPrompt() ||
    session.agent.state.systemPrompt;
  const userPrompt = prompt;
  const providerFields = effectiveProviderFields(telemetry);
  const configuredMaxOutputTokens =
    numberField(providerFields.max_tokens) ??
    numberField(providerFields.max_completion_tokens) ??
    model.maxTokens;
  const runtime: RuntimeConfigurationSnapshot = {
    advisorAssigned: Boolean(spec.expectedModels.advisor),
    advisorCallPolicy: policy.advisorCallPolicy,
    advisorTrustPolicy: policy.advisorTrustPolicy,
    advisorCallsObserved: advisor.calls,
    advisorOrchestration: spec.expectedModels.advisor
      ? {
          alwaysOn: policy.advisorCallPolicy === "mandatory",
          autoLoopGate: false,
          completionGate: policy.advisorCallPolicy === "mandatory",
          failureGate: false,
          gitContext: "off",
          maxCallsPerSession: 4,
          planGate: policy.advisorCallPolicy === "mandatory",
          scoutEnabled: policy.scoutAvailable,
        }
      : null,
    agentMaxTurns: null,
    agentRetryPolicy: {
      enabled: spec.config.execution.agentRetries > 0,
      maxRetries: spec.config.execution.agentRetries,
    },
    benchmarkConfigHash:
      spec.benchmarkConfigFileHash ?? spec.benchmarkConfigHash,
    ...(spec.benchmarkConfigFileHash
      ? { benchmarkConfigFileHash: spec.benchmarkConfigFileHash }
      : {}),
    compactionEnabled: spec.config.execution.compactionEnabled,
    contextLimits: {
      configuredAgentTimeoutMs:
        (spec.task.timeoutSeconds ?? spec.config.execution.timeoutSeconds) *
        1000,
      ...(spec.config.execution.validatorTimeoutSeconds
        ? {
            configuredValidatorTimeoutMs:
              spec.config.execution.validatorTimeoutSeconds * 1000,
          }
        : {}),
      modelContextWindow: model.contextWindow,
      modelMaxOutputTokens: model.maxTokens,
    },
    effectiveSystemPrompt: systemPrompt,
    effectiveSystemPromptHash: hashText(systemPrompt),
    effectiveUserPrompt: userPrompt,
    effectiveUserPromptHash: hashText(userPrompt),
    environmentVariables: relevantEnvironment(),
    executionTimeoutMs:
      (spec.task.timeoutSeconds ?? spec.config.execution.timeoutSeconds) * 1000,
    fixtureHash: spec.task.fixtureHash,
    initialWorkspaceHash: spec.task.fixtureHash,
    maxOutputTokens: configuredMaxOutputTokens,
    mode: spec.mode,
    providerRequestFields: telemetry.providerRequests.map((fields) => ({
      ...fields,
    })),
    modelCapabilities: {
      api: model.api,
      contextWindow: model.contextWindow,
      id: model.id,
      input: [...model.input],
      maxTokens: model.maxTokens,
      provider: model.provider,
      reasoning: model.reasoning,
      ...(model.samplingParams ? { samplingParams: model.samplingParams } : {}),
      thinkingLevel: session.thinkingLevel,
      ...(model.thinkingLevelMap
        ? { thinkingLevelMap: model.thinkingLevelMap }
        : {}),
    },
    profileHash: hashJson({
      activeTools,
      advisorCallPolicy: policy.advisorCallPolicy,
      advisorToolAvailable: policy.advisorToolAvailable,
      advisorTrustPolicy: policy.advisorTrustPolicy,
      agentRetries: spec.config.execution.agentRetries,
      compactionEnabled: spec.config.execution.compactionEnabled,
      scoutAvailable: policy.scoutAvailable,
      thinkingLevel: session.thinkingLevel,
    }),
    reasoningEffort:
      typeof providerFields.reasoning_effort === "string"
        ? providerFields.reasoning_effort
        : modelThinkingValue(model),
    requestedModel: spec.expectedModels.executor,
    resolvedModel: `${model.provider}/${model.id}`,
    taskHash: spec.task.taskHash,
    temperature: numberField(providerFields.temperature),
    toolAvailability: session.getActiveToolNames(),
    toolDefinitions: toolDefinitions(session, activeTools),
    toolTimeouts: Object.fromEntries(activeTools.map((name) => [name, null])),
    topP: numberField(providerFields.top_p),
  };
  session.dispose();
  const result: RawBenchmarkResult = {
    advisor,
    agentDurationMs: Date.now() - setupStarted,
    category: spec.task.category,
    correct: false,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    executor,
    experimentHash: spec.benchmarkConfigHash,
    failureClass:
      termination.state === "timeout"
        ? "agent-timeout"
        : termination.state === "provider-error"
          ? "provider-failure"
          : termination.state === "settled"
            ? undefined
            : "agent-failure",
    mode: spec.mode,
    modelIds: {
      requested: {
        advisor: spec.expectedModels.advisor ?? null,
        executor: spec.expectedModels.executor,
        scout: spec.expectedModels.scout ?? null,
      },
      resolved: {
        advisor: spec.expectedModels.advisor ?? null,
        executor: `${model.provider}/${model.id}`,
        scout: spec.expectedModels.scout ?? null,
      },
    },
    profile: {
      agentRetries: spec.config.execution.agentRetries,
      compactionEnabled: spec.config.execution.compactionEnabled,
      samplingParams: spec.config.execution.samplingParams,
      temperature: spec.config.execution.temperature,
      tools: activeTools,
    },
    provenance: {
      benchmarkConfigHash:
        spec.benchmarkConfigFileHash ?? spec.benchmarkConfigHash,
      fixtureHash: spec.task.fixtureHash,
      harnessVersion: BENCHMARK_HARNESS_VERSION,
      profileHash: runtime.profileHash,
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      systemPromptHash: hashText(systemPrompt),
      taskHash: spec.task.taskHash,
      validatorHash: spec.task.validatorHash,
    },
    repetition: spec.repetition,
    runId: spec.runId,
    runKey: spec.runKey,
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    scout,
    seed: spec.seed,
    setupDurationMs: setupStarted - started,
    taskId: spec.task.id,
    trajectory: {
      ...trajectory,
      changedFiles: workspace.changedPaths.length,
      modelCalls: executor.calls + advisor.calls + scout.calls,
    },
    trajectoryEvents,
    runtime,
    termination,
    totalCost: null,
    validation: {
      durationMs: 0,
      exitCode: null,
      failureReason: "pending parent validation",
      passed: false,
      stderrSummary: "",
      stdoutSummary: "",
      timedOut: false,
    },
    validationDurationMs: 0,
    workspace,
  };
  process.stdout.write(
    `${JSON.stringify({
      extensions: extensionsResult.errors,
      result,
      telemetry: telemetry.all,
    })}\n`
  );
};

run().catch((error) =>
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error))
);
