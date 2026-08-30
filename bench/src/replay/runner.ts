/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: replay checks all failsafe dimensions in one serial run. */
/* biome-ignore-all lint/performance/noAwaitInLoops: replay serializes requests so fixture order and captured responses are deterministic. */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { capToolResult } from "../../../src/conversation.js";
import { runAdvisorGate } from "../../../src/tools.js";
import {
  BudgetGuard,
  formatBudgetEstimate,
  validateBudgetPlan,
} from "../budget.js";
import { DEFAULT_CONFIG } from "../config.js";
import { defaultControlAdvice, runControls } from "../controls.js";
import {
  advisorContextForItem,
  assertAdvisorPayloadExcludesKey,
} from "../decision-context.js";
import {
  discoverDecisionItems,
  hashTree,
  loadReplayFixture,
} from "../fixture.js";
import {
  decisionEffect,
  failureEffect,
  GATE_FAILURE_MODES,
  parseGateResponse,
} from "../gates.js";
import {
  assertRecordedRequestPins,
  capturePins,
  normalizeVolatileFields,
} from "../pins.js";
import { reportFor, writeReport } from "../report.js";
import type {
  BenchmarkConfig,
  BenchmarkReport,
  GateFailureMode,
  ReplayCapture,
  ReplayFixture,
} from "../types.js";
import { MockProviderServer, registerMockProvider } from "./mock-provider.js";

const jsonHash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

const forbiddenPayloadValues = [
  "super-secret-replay-token",
  "untracked-private-content",
  "key/answer.toml",
];

const leaksIn = (value: unknown) => {
  const text = JSON.stringify(value);
  return forbiddenPayloadValues.filter((secret) => text.includes(secret));
};

const fixtureFiles = (root: string) =>
  readdirSync(resolve(root))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(resolve(root), name));

const expectedGateOutcome = (
  fixture: ReplayFixture,
  mode: GateFailureMode,
  text: string
) => {
  const local = parseGateResponse(text);
  const actual = local.decision ?? "failure";
  const expected = fixture.gate?.expected ?? "failure";
  const effect = local.decision
    ? decisionEffect(local.decision, mode)
    : failureEffect(mode);
  return {
    actual,
    effect,
    labelMatches: actual === expected,
    localParserMatches:
      local.decision === undefined
        ? expected === "failure"
        : actual === expected,
  };
};

const replayAdvisorConfig = (model: string) => ({
  advisor: model,
  advisorEffort: "medium",
  advisorGitContext: "off",
  advisorGitContextMaxChars: 0,
  advisorMaxCallsPerSession: 1,
  advisorRedactSecrets: true,
  advisorScoutEnabled: false,
  advisorToolResultMaxBytes: 512,
  advisorToolResultMaxLines: 5,
  contextMaxChars: 2000,
  executor: model,
  executorEffort: "medium",
});

const withReplayConfig = (model: string) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-advisor-replay-agent-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  writeFileSync(
    join(directory, "advisor.json"),
    `${JSON.stringify(replayAdvisorConfig(model), null, 2)}\n`
  );
  process.env.PI_CODING_AGENT_DIR = directory;
  return () => {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previous;
    }
    rmSync(directory, { force: true, recursive: true });
  };
};

const replayModel = (server: MockProviderServer) => ({
  api: "openai-completions" as const,
  baseUrl: server.baseUrl,
  compat: { supportsReasoningEffort: true },
  contextWindow: 128_000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "replay-model",
  input: ["text" as const],
  maxTokens: 4096,
  name: "Replay model",
  provider: "bench-replay",
  reasoning: true,
});

const replayContext = (
  cwd: string,
  fixture: ReplayFixture,
  timestamp: string,
  model: ReturnType<typeof replayModel>
) => {
  const conversation = `${String(fixture.payload.conversation ?? "")}\nToken: super-secret-replay-token`;
  const entries = [
    {
      message: {
        content: [{ text: conversation, type: "text" }],
        role: "user",
        timestamp: 1,
      },
      type: "message",
    },
    {
      message: {
        content: [
          {
            text: `${"bounded-tool-output\n".repeat(20)}end-of-output`,
            type: "text",
          },
        ],
        isError: false,
        role: "toolResult",
        toolName: "read",
      },
      type: "message",
    },
  ];
  return {
    cwd,
    hasUI: false,
    isProjectTrusted: () => false,
    mode: "print",
    modelRegistry: {
      find: (provider: string, id: string) =>
        provider === model.provider && id === model.id ? model : undefined,
      getApiKeyAndHeaders: () =>
        Promise.resolve({ apiKey: "bench-replay", ok: true as const }),
    },
    replayTimestamp: timestamp,
    sessionManager: { getBranch: () => entries },
  } as never;
};

/**
 * Runs the shipped gate path while adding one explicit volatile field at the
 * provider boundary. The production request timestamp is not part of the
 * OpenAI wire schema, so this keeps the replay's normalization assertion
 * honest without changing src/.
 */
const runRealGate = async (
  server: MockProviderServer,
  fixture: ReplayFixture,
  cwd: string,
  timestamp: string
) => {
  const model = replayModel(server);
  server.enqueue({
    text: fixture.gate?.response ?? "Decision: proceed",
    usage: { input: 128, output: 32, totalTokens: 160 },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input, init) => {
    if (typeof init?.body !== "string") {
      return originalFetch(input, init);
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(init.body);
      body =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? { ...(parsed as Record<string, unknown>), timestamp }
          : { timestamp };
    } catch {
      return originalFetch(input, init);
    }
    return originalFetch(input, { ...init, body: JSON.stringify(body) });
  }) as typeof globalThis.fetch;
  try {
    const result = await runAdvisorGate(
      replayContext(cwd, fixture, timestamp, model),
      String(fixture.payload.draft ?? "Replay gate fixture"),
      "repeated-tool-call"
    );
    const capture = server.requests.at(-1);
    if (!capture) {
      throw new Error(
        `Replay fixture ${fixture.id} produced no provider capture.`
      );
    }
    const text = result.ok
      ? result.markdown
      : (result.markdown ?? `${result.category}: ${result.message}`);
    return { capture, result, text };
  } finally {
    globalThis.fetch = originalFetch;
  }
};

interface ReplayPairResult {
  captures: ReplayCapture[];
  contextPassed: boolean;
  deterministic: boolean;
  gate: Record<string, unknown>;
  privacyLeaks: string[];
}

const replayPair = async (
  server: MockProviderServer,
  fixture: ReplayFixture,
  mode: GateFailureMode,
  cwd: string,
  requestBudget: BudgetGuard,
  sessionCallCounts: Map<string, number>
): Promise<ReplayPairResult> => {
  const runSession = (sessionId: string, timestamp: string) => {
    const calls = sessionCallCounts.get(sessionId) ?? 0;
    if (calls >= 1) {
      throw new Error(
        `Replay session ${sessionId} exceeded its one-call budget.`
      );
    }
    sessionCallCounts.set(sessionId, calls + 1);
    requestBudget.reserve(0);
    return runRealGate(server, fixture, cwd, timestamp);
  };
  const first = await runSession(
    `${fixture.id}:${mode}:first`,
    `${fixture.id}-${mode}-first`
  );
  const second = await runSession(
    `${fixture.id}:${mode}:second`,
    `${fixture.id}-${mode}-second`
  );
  const payloads = [first.capture.body, second.capture.body];
  const hashes = payloads.map(jsonHash);
  const normalizedHashes = payloads.map((payload) =>
    jsonHash(normalizeVolatileFields(payload, fixture.volatileFields))
  );
  const captures = payloads.map((payload, index) => {
    const result = index === 0 ? first : second;
    const leaks = leaksIn(payload);
    return {
      fixtureId: `${fixture.id}:${mode}:${index === 0 ? "first" : "second"}`,
      leakCount: leaks.length,
      leaks,
      normalizedPayloadHash: normalizedHashes[index],
      payload,
      payloadBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
      response: result.text,
    } satisfies ReplayCapture;
  });
  const firstOutcome = expectedGateOutcome(fixture, mode, first.text);
  const secondOutcome = expectedGateOutcome(fixture, mode, second.text);
  const firstPayloadText = JSON.stringify(first.capture.body.messages);
  const secondPayloadText = JSON.stringify(second.capture.body.messages);
  return {
    captures,
    contextPassed: [firstPayloadText, secondPayloadText].every(
      (text) =>
        text.includes("omitted tool-result") &&
        !text.includes("key/answer.toml") &&
        !text.includes("untracked-private-content")
    ),
    deterministic:
      hashes[0] !== hashes[1] &&
      normalizedHashes[0] === normalizedHashes[1] &&
      first.text === second.text,
    gate: {
      case: fixture.gate?.case,
      effect: firstOutcome.effect,
      expected: fixture.gate?.expected,
      failureMode: mode,
      fixture: fixture.id,
      labelMatches: firstOutcome.labelMatches && secondOutcome.labelMatches,
      localParserMatches:
        firstOutcome.localParserMatches && secondOutcome.localParserMatches,
    },
    privacyLeaks: captures.flatMap((capture) => capture.leaks),
  };
};

export interface ReplayRunOptions {
  announceBudget?: boolean;
  config?: BenchmarkConfig;
  reportTimestamp?: string;
  writeReportOutput?: boolean;
}

export const runReplay = async ({
  announceBudget = true,
  config,
  reportTimestamp,
  writeReportOutput = true,
}: ReplayRunOptions = {}): Promise<BenchmarkReport> => {
  const effectiveConfig = config ?? DEFAULT_CONFIG;
  const fixtureRoot = resolve(effectiveConfig.fixtureRoot, "replay");
  const fixtures = fixtureFiles(fixtureRoot).map(loadReplayFixture);
  if (fixtures.length !== 6) {
    throw new Error(`Replay requires six fixtures, found ${fixtures.length}.`);
  }
  const plannedRequests = fixtures.length * GATE_FAILURE_MODES.length * 2;
  const budgetEstimate = validateBudgetPlan({
    capUsd: effectiveConfig.budgetUsd,
    estimatedUsd: 0,
    expectedCalls: plannedRequests,
    maxCalls: plannedRequests,
    tokenAssumption: { input: 0, output: 0 },
  });
  if (announceBudget) {
    console.log(formatBudgetEstimate(budgetEstimate));
  }
  const requestBudget = new BudgetGuard(effectiveConfig.budgetUsd);
  const server = await new MockProviderServer().start();
  const registrations: unknown[] = [];
  registerMockProvider(
    {
      registerProvider: (_name, provider) => {
        registrations.push(provider);
      },
    },
    server
  );
  if (registrations.length !== 1) {
    throw new Error("Replay mock provider was not registered exactly once.");
  }

  const captures: ReplayCapture[] = [];
  const gateResults: Record<string, unknown>[] = [];
  const sessionCallCounts = new Map<string, number>();
  let privacyLeaks: string[] = [];
  let decisionKeyLeaks: string[] = [];
  let determinismPassed = true;
  let gatePassed = true;
  let contextPassed = true;
  const cleanupConfig = withReplayConfig("bench-replay/replay-model");
  const replayCwd = process.env.TMPDIR ?? tmpdir();
  try {
    for (const fixture of fixtures) {
      if (!fixture.gate) {
        throw new Error(`Replay fixture ${fixture.id} has no gate case.`);
      }
      for (const mode of GATE_FAILURE_MODES) {
        const pair = await replayPair(
          server,
          fixture,
          mode,
          replayCwd,
          requestBudget,
          sessionCallCounts
        );
        captures.push(...pair.captures);
        privacyLeaks = [...privacyLeaks, ...pair.privacyLeaks];
        determinismPassed = determinismPassed && pair.deterministic;
        contextPassed = contextPassed && pair.contextPassed;
        const labelMatches = pair.gate.labelMatches === true;
        const localParserMatches = pair.gate.localParserMatches === true;
        gatePassed = gatePassed && labelMatches && localParserMatches;
        gateResults.push(pair.gate);
      }
    }
  } finally {
    cleanupConfig();
    await server.close();
  }
  assertRecordedRequestPins(
    server.requests.map((entry) => entry.request),
    { effort: "medium", model: "bench-replay/replay-model", role: "advisor" }
  );
  if (existsSync("bench/tasks")) {
    try {
      for (const item of discoverDecisionItems("bench/tasks")) {
        const context = advisorContextForItem(item);
        const leaks = leaksIn(context).filter(
          (leak) => leak.includes("answer.toml") || leak.includes("traps.toml")
        );
        try {
          assertAdvisorPayloadExcludesKey(item, context);
        } catch (error) {
          leaks.push(error instanceof Error ? error.message : String(error));
        }
        decisionKeyLeaks = [...decisionKeyLeaks, ...leaks];
      }
    } catch (error) {
      decisionKeyLeaks.push(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const capped = capToolResult("line\n".repeat(100), 5, 512);
  contextPassed =
    contextPassed &&
    capped.truncated &&
    capped.content.includes("omitted tool-result") &&
    Buffer.byteLength(capped.content, "utf8") <= 512;
  const controlRun = runControls(
    resolve(effectiveConfig.fixtureRoot, "controls"),
    defaultControlAdvice
  );
  const budget = new BudgetGuard(0.01);
  const firstReservation = budget.reserve(0.01);
  let exhaustedObserved = false;
  try {
    budget.reserve(0.01);
  } catch {
    exhaustedObserved = true;
  }
  budget.settle(firstReservation, 0);
  const fixtureHash = hashTree(fixtureRoot);
  const warnings = [
    "Replay validates the shipped parser, configuration, redaction, context, and usage seams with a local provider boundary; it does not claim live model quality.",
  ];
  const status =
    gatePassed &&
    privacyLeaks.length === 0 &&
    decisionKeyLeaks.length === 0 &&
    contextPassed &&
    exhaustedObserved &&
    determinismPassed &&
    server.requests.length === plannedRequests &&
    !controlRun.controls.invalid
      ? "PASS"
      : "INVALID";
  const report = {
    ...reportFor(
      "replay",
      effectiveConfig,
      {
        budget: {
          consumedRequests: server.requests.length,
          exhaustedObserved,
          requests: captures.length,
          sessionBudget: {
            configuredMaxCallsPerSession: 1,
            maxObservedCallsPerSession: Math.max(...sessionCallCounts.values()),
            sessions: sessionCallCounts.size,
          },
        },
        context: {
          passed: contextPassed,
          truncatedBytes: capped.totalBytes,
        },
        controls: controlRun.scores,
        cost: { source: "local mock provider", usd: 0 },
        determinism: {
          capturePairs: captures.length / 2,
          passed: determinismPassed,
          pinAssertion: true,
          recordedRequests: server.requests.length,
          volatileFields: ["timestamp"],
        },
        gateConformance: {
          cases: gateResults,
          passed: gateResults.filter((result) => result.labelMatches).length,
          total: gateResults.length,
        },
        privacy: {
          leakCount: privacyLeaks.length + decisionKeyLeaks.length,
          leaks: [...privacyLeaks, ...decisionKeyLeaks],
        },
        requests: captures,
      },
      {
        budget: budgetEstimate,
        controls: controlRun.controls,
        fixtureHashes: { replay: fixtureHash },
        generatedAt: reportTimestamp,
        status,
        warnings,
      }
    ),
    pins: capturePins(effectiveConfig, { replay: fixtureHash }),
  } satisfies BenchmarkReport;
  if (writeReportOutput) {
    writeReport(report, undefined, effectiveConfig.reportRoot);
  }
  return report;
};
