/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: this runner keeps arm, repeat, scoring, control, and budget state together for auditable reports. */
/* biome-ignore-all lint/performance/noAwaitInLoops: provider requests are serialized to reserve and settle the hard budget before the next call. */
import { resolve } from "node:path";
import {
  BudgetExceededError,
  BudgetGuard,
  formatBudgetEstimate,
  validateBudgetPlan,
} from "./budget.ts";
import {
  armModelPins,
  DEFAULT_CONFIG,
  defaultPricingFor,
  modelPin,
} from "./config.ts";
import { controlJudge, defaultControlAdvice, runControls } from "./controls.ts";
import {
  CostMeter,
  configuredCost,
  estimateCost,
  normalizeUsage,
} from "./cost.ts";
import {
  advisorContextForItem,
  assertAdvisorPayloadExcludesKey,
} from "./decision-context.ts";
import { discoverDecisionItems, hashTree } from "./fixture.ts";
import { LiveModelClient, readLiveClientConfig } from "./live-client.ts";
import { assertPinnedLiveModelConfiguration } from "./pins.ts";
import { reportFor, writeReport } from "./report.ts";
import { scoreAdvice } from "./score/index.ts";
import { buildJudgePrompt, type JudgeInvoker } from "./score/judge.ts";
import type {
  BenchmarkConfig,
  BenchmarkReport,
  DecisionItem,
  DecisionScore,
  ModelPin,
} from "./types.ts";

const DECISION_REPEATS = 3;
const DECISION_ITEM_COUNT = 24;
const LIVE_ADVISOR_CALLS = DECISION_ITEM_COUNT * DECISION_REPEATS * 2;
const LIVE_JUDGE_CALLS = DECISION_ITEM_COUNT * DECISION_REPEATS * 4;
const SCOUT_SAMPLE_COUNT = DECISION_ITEM_COUNT * DECISION_REPEATS;
const SCOUT_EXTRA_CALLS = SCOUT_SAMPLE_COUNT * 3;
const DEFAULT_TOKEN_ASSUMPTION = { input: 4000, output: 1000 };

const liveArms = ["cheap", "frontier"] as const;
const allArms = ["null", "cheap", "frontier", "oracle"] as const;
type DecisionArm = (typeof allArms)[number];

const sourceClusters = (items: readonly DecisionItem[]) => {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(
      item.provenance.origin,
      (counts.get(item.provenance.origin) ?? 0) + 1
    );
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
};

interface Observation {
  advice: string;
  advisorLatencyMs?: number;
  arm: DecisionArm;
  item: DecisionItem;
  repeat: number;
  score: DecisionScore;
  usage?: unknown;
}

interface ArmMeters {
  advisor: CostMeter;
  judge: CostMeter;
}

type CostMeters = Map<DecisionArm, ArmMeters>;

const metersFor = (costByArm: CostMeters, arm: DecisionArm): ArmMeters => {
  const current = costByArm.get(arm);
  if (current) {
    return current;
  }
  const created = { advisor: new CostMeter(), judge: new CostMeter() };
  costByArm.set(arm, created);
  return created;
};

export interface DecisionRunOptions {
  announceBudget?: boolean;
  config?: BenchmarkConfig;
  live?: boolean;
  reportTimestamp?: string;
  writeReportOutput?: boolean;
}

const numberFromEnv = (name: string, fallback: number) => {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  }
  return parsed;
};

const deterministicJudge = async ({
  item,
  advice,
}: {
  item: DecisionItem;
  advice: string;
  pin: ModelPin;
}) => ({
  effort: "medium",
  latencyMs: 0,
  model: "deterministic/control-judge",
  text: JSON.stringify({
    justification:
      item.polarity === "positive"
        ? "The deterministic control rubric checked the keyed defect."
        : "The deterministic control rubric checked the known-correct choices.",
    pass: controlJudge(item, advice),
  }),
});

const summaryFor = (
  arm: DecisionArm,
  observations: Observation[],
  cost: number | "unavailable",
  repeats: number
) => {
  const positiveObservations = observations.filter(
    (observation) => observation.item.polarity === "positive"
  );
  const negativeObservations = observations.filter(
    (observation) => observation.item.polarity === "negative"
  );
  const scores = observations.map((observation) => observation.score);
  const positives = positiveObservations.map(
    (observation) => observation.score
  );
  const negatives = negativeObservations.map(
    (observation) => observation.score
  );
  const rate = (values: DecisionScore[], field: "caught" | "falseAlarm") =>
    values.length
      ? values.filter((score) => score[field]).length / values.length
      : 0;
  const mechanical = positives.length
    ? positives.filter((score) => score.mechanical === true).length /
      positives.length
    : 0;
  const judgeValues = scores.filter(
    (score) => score.judge !== undefined && score.judge !== null
  );
  const judgePositiveValues = positives.filter(
    (score) => score.judge !== undefined && score.judge !== null
  );
  const latencies = observations
    .map((observation) =>
      observation.advisorLatencyMs === undefined
        ? observation.score.latencyMs
        : observation.advisorLatencyMs + (observation.score.latencyMs ?? 0)
    )
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    latencies.length
      ? latencies[
          Math.min(
            latencies.length - 1,
            Math.floor((latencies.length - 1) * fraction)
          )
        ]
      : null;
  const caught = positives.filter((score) => score.caught).length;
  const usdPerCatch =
    caught > 0 && cost !== "unavailable" ? cost / caught : "unavailable";
  const catchRate = rate(positives, "caught");
  const falseAlarmRate = rate(negatives, "falseAlarm");
  const judgeCatchRate = judgePositiveValues.length
    ? judgePositiveValues.filter((score) => score.judge === true).length /
      judgePositiveValues.length
    : 0;
  return {
    arm,
    catch_rate: catchRate,
    catchRate,
    caught,
    false_alarm_rate: falseAlarmRate,
    falseAlarmRate,
    J: catchRate - falseAlarmRate,
    judge_catch_rate: judgeCatchRate,
    judgeCoverage: scores.length ? judgeValues.length / scores.length : 0,
    mechanical_catch_rate: mechanical,
    mechanicalCatchRate: mechanical,
    p50_added_latency_ms: percentile(0.5),
    p50AddedLatencyMs: percentile(0.5),
    p95_added_latency_ms: percentile(0.95),
    p95AddedLatencyMs: percentile(0.95),
    repeats,
    scoreCount: scores.length,
    usd_per_catch: usdPerCatch,
    usdPerCatch,
  };
};

const deterministicObservations = async (
  items: DecisionItem[],
  config: BenchmarkConfig
): Promise<Observation[]> => {
  const judgePin = modelPin(config, "judge", "judge");
  const observations: Observation[] = [];
  for (const arm of ["null", "oracle"] as const) {
    for (const item of items) {
      const advice = defaultControlAdvice(arm, item);
      for (let repeat = 0; repeat < DECISION_REPEATS; repeat += 1) {
        const score = await scoreAdvice({
          advice,
          arm,
          item,
          judge: deterministicJudge,
          judgePin,
        });
        observations.push({ advice, arm, item, repeat, score });
      }
    }
  }
  return observations;
};

const liveObservations = async (
  items: DecisionItem[],
  config: BenchmarkConfig,
  budget: BudgetGuard,
  tokenAssumption: { input: number; output: number },
  client: LiveModelClient,
  costByArm: CostMeters
): Promise<Observation[]> => {
  const judgePin = modelPin(config, "judge", "judge");
  const judgeFor =
    (arm: DecisionArm): JudgeInvoker =>
    async ({ item, advice, pin }) => {
      const prompt = buildJudgePrompt(item, advice);
      const estimate = estimateCost(
        1,
        defaultPricingFor(config, pin.model) ?? {
          cacheReadPerMillion: 0,
          cacheWritePerMillion: 0,
          inputPerMillion: 0,
          outputPerMillion: 0,
        },
        tokenAssumption
      );
      const reserved = budget.reserve(estimate);
      const response = await client.text({
        pin,
        prompt,
        signal: undefined,
        systemPrompt:
          "You are a narrow, deterministic benchmark judge. Follow the requested JSON output exactly.",
      });
      const pricing = defaultPricingFor(config, pin.model) ?? {
        cacheReadPerMillion: 0,
        cacheWritePerMillion: 0,
        inputPerMillion: 0,
        outputPerMillion: 0,
      };
      const { judge: meter } = metersFor(costByArm, arm);
      meter.record("judge", pin.model, response.usage, pricing);
      const actual = configuredCost(normalizeUsage(response.usage), pricing);
      budget.settle(reserved, actual === "unavailable" ? undefined : actual);
      return {
        ...response,
        effort: pin.effort,
        model: pin.model,
      };
    };
  const observations: Observation[] = [];
  for (const arm of allArms) {
    for (const item of items) {
      const prompt = advisorContextForItem(item, true);
      assertAdvisorPayloadExcludesKey(item, prompt);
      for (let repeat = 0; repeat < DECISION_REPEATS; repeat += 1) {
        let advice: string;
        let advisorLatencyMs: number | undefined;
        let usage: unknown;
        if (arm === "null") {
          advice = defaultControlAdvice("null", item);
        } else if (arm === "oracle") {
          advice = defaultControlAdvice("oracle", item);
        } else {
          const pins = armModelPins(config, arm);
          if (!pins.advisor) {
            throw new Error(`Missing Advisor pin for ${arm}.`);
          }
          const estimate = estimateCost(
            1,
            defaultPricingFor(config, pins.advisor.model) ?? {
              cacheReadPerMillion: 0,
              cacheWritePerMillion: 0,
              inputPerMillion: 0,
              outputPerMillion: 0,
            },
            tokenAssumption
          );
          const reserved = budget.reserve(estimate);
          const response = await client.text({
            pin: pins.advisor,
            prompt,
            systemPrompt:
              "You are the Advisor in a benchmark. Give concise, evidence-based Markdown advice.",
          });
          ({ latencyMs: advisorLatencyMs, text: advice, usage } = response);
          const { advisor: meter } = metersFor(costByArm, arm);
          meter.record(
            "advisor",
            pins.advisor.model,
            response.usage,
            defaultPricingFor(config, pins.advisor.model) ?? {
              cacheReadPerMillion: 0,
              cacheWritePerMillion: 0,
              inputPerMillion: 0,
              outputPerMillion: 0,
            }
          );
          const actual = configuredCost(
            normalizeUsage(response.usage),
            defaultPricingFor(config, pins.advisor.model) ?? {
              cacheReadPerMillion: 0,
              cacheWritePerMillion: 0,
              inputPerMillion: 0,
              outputPerMillion: 0,
            }
          );
          budget.settle(
            reserved,
            actual === "unavailable" ? undefined : actual
          );
        }
        const score = await scoreAdvice({
          advice,
          arm,
          item,
          judge: judgeFor(arm),
          judgePin,
        });
        observations.push({
          advice,
          advisorLatencyMs,
          arm,
          item,
          repeat,
          score,
          usage,
        });
      }
    }
  }
  return observations;
};

const inputTokens = (usage: unknown) => {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }
  const value = (usage as Record<string, unknown>).input;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
};

const addNullable = (left: number | null, right: number | null) =>
  left === null || right === null ? null : left + right;

const sumInputTokens = (usages: unknown[]) =>
  usages.reduce<number | null>(
    (total, usage) => addNullable(total, inputTokens(usage)),
    0
  );

const spendForObservations = (
  observations: Observation[],
  config: BenchmarkConfig,
  advisorPin: ModelPin,
  judgePin: ModelPin
) => {
  let total = 0;
  for (const observation of observations) {
    const advisorPricing = defaultPricingFor(config, advisorPin.model);
    const judgePricing = defaultPricingFor(config, judgePin.model);
    const advisorCost = advisorPricing
      ? configuredCost(normalizeUsage(observation.usage), advisorPricing)
      : "unavailable";
    const judgeCost = judgePricing
      ? configuredCost(normalizeUsage(observation.score.usage), judgePricing)
      : "unavailable";
    if (advisorCost === "unavailable" || judgeCost === "unavailable") {
      return "unavailable" as const;
    }
    total += advisorCost + judgeCost;
  }
  return total;
};

const runScoutComparison = async (
  items: DecisionItem[],
  mainObservations: Observation[],
  config: BenchmarkConfig,
  budget: BudgetGuard,
  tokenAssumption: { input: number; output: number },
  client: LiveModelClient
) => {
  const executorPin = modelPin(config, "executor", "executor");
  const frontierPin = modelPin(config, "decisionAdvisor", "advisor");
  const judgePin = modelPin(config, "judge", "judge");
  const scoutMeter = new CostMeter();
  const advisorMeter = new CostMeter();
  const judgeMeter = new CostMeter();
  const pricingFor = (pin: ModelPin) =>
    defaultPricingFor(config, pin.model) ?? {
      cacheReadPerMillion: 0,
      cacheWritePerMillion: 0,
      inputPerMillion: 0,
      outputPerMillion: 0,
    };
  const call = async (
    pin: ModelPin,
    prompt: string,
    meter: CostMeter,
    role: "executor" | "advisor" | "judge"
  ) => {
    const pricing = pricingFor(pin);
    const reserved = budget.reserve(estimateCost(1, pricing, tokenAssumption));
    const response = await client.text({
      pin,
      prompt,
      systemPrompt:
        role === "judge"
          ? "You are a narrow, deterministic benchmark judge. Follow the requested JSON output exactly."
          : "You are a benchmark model. Return concise evidence-based text.",
    });
    meter.record(role, pin.model, response.usage, pricing);
    const actual = configuredCost(normalizeUsage(response.usage), pricing);
    budget.settle(reserved, actual === "unavailable" ? undefined : actual);
    return response;
  };
  const judge = async ({ item, advice, pin }: Parameters<JudgeInvoker>[0]) => {
    const response = await call(
      pin,
      buildJudgePrompt(item, advice),
      judgeMeter,
      "judge"
    );
    return { ...response, effort: pin.effort, model: pin.model };
  };
  const off = mainObservations.filter(
    (observation) => observation.arm === "frontier"
  );
  const on: Observation[] = [];
  const scoutUsages: unknown[] = [];
  const onAdvisorUsages: unknown[] = [];
  for (const item of items) {
    const prompt = advisorContextForItem(item, true);
    assertAdvisorPayloadExcludesKey(item, prompt);
    for (let repeat = 0; repeat < DECISION_REPEATS; repeat += 1) {
      const scout = await call(
        executorPin,
        `Select the smallest relevant evidence for this review.\n\n${prompt}`,
        scoutMeter,
        "executor"
      );
      const advisor = await call(
        frontierPin,
        `${prompt}\n\nUntrusted Scout selection:\n${scout.text}`,
        advisorMeter,
        "advisor"
      );
      const score = await scoreAdvice({
        advice: advisor.text,
        arm: "frontier",
        item,
        judge,
        judgePin,
      });
      on.push({
        advice: advisor.text,
        advisorLatencyMs: advisor.latencyMs,
        arm: "frontier",
        item,
        repeat,
        score,
        usage: advisor.usage,
      });
      scoutUsages.push(scout.usage);
      onAdvisorUsages.push(advisor.usage);
    }
  }
  const offSpend = spendForObservations(off, config, frontierPin, judgePin);
  const onSpend = spendForObservations(on, config, frontierPin, judgePin);
  const scoutSpend = scoutMeter.totalConfiguredCost();
  let extraSpend: number | "unavailable" = "unavailable";
  if (
    offSpend !== "unavailable" &&
    onSpend !== "unavailable" &&
    scoutSpend !== "unavailable"
  ) {
    extraSpend = onSpend - offSpend + scoutSpend;
  }
  const offSummary = summaryFor("frontier", off, offSpend, DECISION_REPEATS);
  const onSummary = summaryFor("frontier", on, onSpend, DECISION_REPEATS);
  const offInput = sumInputTokens(off.map((observation) => observation.usage));
  const onInput = sumInputTokens(onAdvisorUsages);
  const inputDelta =
    offInput === null || onInput === null ? null : onInput - offInput;
  return {
    advisorInputTokens: { delta: inputDelta, off: offInput, on: onInput },
    J: {
      delta: onSummary.J - offSummary.J,
      off: offSummary.J,
      on: onSummary.J,
    },
    latencyMs: {
      off: offSummary.p50_added_latency_ms,
      on: onSummary.p50_added_latency_ms,
    },
    scoutInputTokens: sumInputTokens(scoutUsages),
    spend: {
      delta: extraSpend,
      off: offSpend,
      on: onSpend,
      scout: scoutSpend,
    },
    status: "complete",
  };
};

const controlsFrom = (observations: Observation[], items: DecisionItem[]) => {
  const positiveCount = items.filter(
    (item) => item.polarity === "positive"
  ).length;
  const negativeCount = items.filter(
    (item) => item.polarity === "negative"
  ).length;
  const rate = (
    arm: DecisionArm,
    polarity: "positive" | "negative",
    field: "caught" | "falseAlarm"
  ) => {
    const scores = observations.filter(
      (observation) =>
        observation.arm === arm && observation.item.polarity === polarity
    );
    return scores.length
      ? scores.filter((observation) => observation.score[field]).length /
          scores.length
      : 0;
  };
  return {
    invalid:
      rate("null", "positive", "caught") > 0.2 ||
      rate("oracle", "positive", "caught") < 0.9 ||
      rate("oracle", "negative", "falseAlarm") > 0.1,
    negativeCount,
    nullCatchRate: rate("null", "positive", "caught"),
    oracleCatchRate: rate("oracle", "positive", "caught"),
    oracleFalseAlarmRate: rate("oracle", "negative", "falseAlarm"),
    positiveCount,
  };
};

const armCosts = (costByArm: CostMeters, role: keyof ArmMeters) =>
  Object.fromEntries(
    allArms.map((arm) => {
      const meter = costByArm.get(arm)?.[role];
      if (!meter) {
        return [arm, 0];
      }
      const cost = meter.totalConfiguredCost();
      return [arm, cost === "unavailable" ? "unavailable" : cost];
    })
  );

const armProviderCosts = (costByArm: CostMeters, role: keyof ArmMeters) =>
  Object.fromEntries(
    allArms.map((arm) => {
      const meter = costByArm.get(arm)?.[role];
      if (!meter) {
        return [arm, 0];
      }
      const cost = meter.totalProviderCost();
      return [arm, cost === "unavailable" ? "unavailable" : cost];
    })
  );

const pricingUnavailable = (config: BenchmarkConfig, pin: ModelPin) => {
  const pricing = defaultPricingFor(config, pin.model);
  return !pricing || Object.values(pricing).every((rate) => rate === 0);
};

const missingLiveCost = (config: BenchmarkConfig, includeScout: boolean) =>
  liveArms.some((arm) => {
    const { advisor } = armModelPins(config, arm);
    return !advisor || pricingUnavailable(config, advisor);
  }) ||
  pricingUnavailable(config, modelPin(config, "judge", "judge")) ||
  (includeScout &&
    pricingUnavailable(config, modelPin(config, "executor", "executor")));

const decisionBudget = (config: BenchmarkConfig, includeScout: boolean) => {
  const tokenAssumption = {
    input: numberFromEnv("BENCH_INPUT_TOKENS", DEFAULT_TOKEN_ASSUMPTION.input),
    output: numberFromEnv(
      "BENCH_OUTPUT_TOKENS",
      DEFAULT_TOKEN_ASSUMPTION.output
    ),
  };
  const cheapCalls = LIVE_ADVISOR_CALLS / 2;
  const frontierCalls = LIVE_ADVISOR_CALLS / 2;
  const judgeCalls = LIVE_JUDGE_CALLS;
  const scoutCalls = includeScout ? DECISION_ITEM_COUNT * DECISION_REPEATS : 0;
  const extraFrontierCalls = scoutCalls;
  const calls =
    cheapCalls + frontierCalls + judgeCalls + scoutCalls + extraFrontierCalls;
  const price = (pin: ModelPin) => defaultPricingFor(config, pin.model);
  const cheapPricing = price(modelPin(config, "cheapAdvisor", "advisor"));
  const frontierPricing = price(modelPin(config, "decisionAdvisor", "advisor"));
  const judgePricing = price(modelPin(config, "judge", "judge"));
  const scoutPricing = price(modelPin(config, "executor", "executor"));
  const estimatedUsd =
    (cheapPricing
      ? estimateCost(cheapCalls, cheapPricing, tokenAssumption)
      : 0) +
    (frontierPricing
      ? estimateCost(
          frontierCalls + extraFrontierCalls,
          frontierPricing,
          tokenAssumption
        )
      : 0) +
    (judgePricing
      ? estimateCost(
          judgeCalls + (includeScout ? scoutCalls : 0),
          judgePricing,
          tokenAssumption
        )
      : 0) +
    (includeScout && scoutPricing
      ? estimateCost(scoutCalls, scoutPricing, tokenAssumption)
      : 0);
  return {
    calls,
    estimate: validateBudgetPlan({
      capUsd: config.budgetUsd,
      estimatedUsd,
      expectedCalls: calls,
      maxCalls: calls,
      tokenAssumption,
    }),
    tokenAssumption,
  };
};

const unavailableReport = (
  config: BenchmarkConfig,
  message: string,
  reportTimestamp?: string
) => {
  const controlRun = runControls(
    resolve(config.fixtureRoot, "controls"),
    defaultControlAdvice
  );
  return reportFor(
    "decisions",
    config,
    {
      arms: Object.fromEntries(
        allArms.map((arm) => [arm, { status: "UNAVAILABLE" }])
      ),
      controlSource: "deterministic fixture controls only",
      controls: controlRun.scores,
      itemCount: 0,
    },
    {
      controls: controlRun.controls,
      fixtureHashes: { decisions: resolveDecisionHash() },
      generatedAt: reportTimestamp,
      status: "UNAVAILABLE",
      warnings: [message],
    }
  );
};

export const runDecisions = async ({
  announceBudget = true,
  config = DEFAULT_CONFIG,
  live = false,
  reportTimestamp,
  writeReportOutput = true,
}: DecisionRunOptions = {}): Promise<BenchmarkReport> => {
  const items = discoverDecisionItems(resolve("bench/tasks"));
  if (items.length !== DECISION_ITEM_COUNT) {
    throw new Error(
      `Decision benchmark requires ${DECISION_ITEM_COUNT} items, found ${items.length}.`
    );
  }
  const polarityCounts = {
    negative: items.filter((item) => item.polarity === "negative").length,
    positive: items.filter((item) => item.polarity === "positive").length,
  };
  if (polarityCounts.positive !== 12 || polarityCounts.negative !== 12) {
    throw new Error(
      "Decision benchmark requires 12 positive and 12 negative items."
    );
  }
  if (!live) {
    const observations = await deterministicObservations(items, config);
    const controls = controlsFrom(observations, items);
    const metrics = {
      arms: Object.fromEntries(
        allArms.map((arm) => [
          arm,
          summaryFor(
            arm,
            observations.filter((observation) => observation.arm === arm),
            0,
            DECISION_REPEATS
          ),
        ])
      ),
      controls,
      itemCount: items.length,
      live: false,
      polarityCounts,
      rawScores: observations.map(({ score, arm, repeat }) => ({
        ...score,
        arm,
        repeat,
      })),
      scorer: {
        judge: "deterministic control rubric",
        mechanical: "positive items only",
      },
      sourceClusters: sourceClusters(items),
    };
    const report = reportFor("decisions", config, metrics, {
      controls,
      fixtureHashes: { decisions: resolveDecisionHash() },
      gateSettings: { advisorScoutEnabled: false, repeats: DECISION_REPEATS },
      generatedAt: reportTimestamp,
      status: controls.invalid ? "INVALID" : "PASS",
      warnings: [
        "Offline decision run validates item shape and null/oracle separation only; it is not a live model-quality result.",
        "The 24 decision points include three derived items per eight source tasks; rates are item-level diagnostics, not independent source-task evidence.",
      ],
    });
    if (writeReportOutput) {
      writeReport(report, undefined, config.reportRoot);
    }
    return report;
  }

  assertPinnedLiveModelConfiguration(config);
  const includeScout = process.env.BENCH_SCOUT === "1";
  if (missingLiveCost(config, includeScout)) {
    const report = unavailableReport(
      config,
      "Live decision scoring requires non-zero pricing for every live Advisor and judge pin; no number is imputed.",
      reportTimestamp
    );
    if (writeReportOutput) {
      writeReport(report, undefined, config.reportRoot);
    }
    return report;
  }
  const budgetPlan = decisionBudget(config, includeScout);
  if (announceBudget) {
    console.log(formatBudgetEstimate(budgetPlan.estimate));
  }
  if (budgetPlan.estimate.estimatedUsd > config.budgetUsd) {
    throw new BudgetExceededError(
      `Estimated decision benchmark spend $${budgetPlan.estimate.estimatedUsd.toFixed(4)} exceeds $${config.budgetUsd.toFixed(4)} cap.`
    );
  }
  const client = new LiveModelClient(readLiveClientConfig());
  const budget = new BudgetGuard(config.budgetUsd);
  const costByArm: CostMeters = new Map();
  const observations = await liveObservations(
    items,
    config,
    budget,
    budgetPlan.tokenAssumption,
    client,
    costByArm
  );
  const controls = controlsFrom(observations, items);
  const scout = includeScout
    ? await runScoutComparison(
        items,
        observations,
        config,
        budget,
        budgetPlan.tokenAssumption,
        client
      )
    : { status: "not-run" as const };
  const costs = armCosts(costByArm, "advisor");
  const judgeCosts = armCosts(costByArm, "judge");
  const providerCosts = armProviderCosts(costByArm, "advisor");
  const providerJudgeCosts = armProviderCosts(costByArm, "judge");
  const metrics = {
    arms: Object.fromEntries(
      allArms.map((arm) => [
        arm,
        summaryFor(
          arm,
          observations.filter((observation) => observation.arm === arm),
          costs[arm] as number | "unavailable",
          DECISION_REPEATS
        ),
      ])
    ),
    budget: budget.snapshot(),
    controls,
    costByArm: costs,
    itemCount: items.length,
    judgeCostByArm: judgeCosts,
    live: true,
    pinRequests: client.requests,
    polarityCounts,
    providerCostByArm: providerCosts,
    providerJudgeCostByArm: providerJudgeCosts,
    rawScores: observations.map(({ score, arm, repeat }) => ({
      ...score,
      arm,
      repeat,
    })),
    scorer: { judge: "pinned LLM judge", mechanical: "positive items only" },
    scout,
    sourceClusters: sourceClusters(items),
  };
  const report = reportFor("decisions", config, metrics, {
    budget: budgetPlan.estimate,
    controls,
    fixtureHashes: { decisions: resolveDecisionHash() },
    gateSettings: {
      advisorScoutEnabled: includeScout,
      repeats: DECISION_REPEATS,
    },
    generatedAt: reportTimestamp,
    status: controls.invalid ? "INVALID" : "PASS",
    warnings: [
      "With 24 items, this tier distinguishes clearly better from clearly worse and nothing finer; ties within one item are reported as ties.",
      "The 24 decision points include three derived items per eight source tasks; rates are item-level diagnostics, not independent source-task evidence.",
    ],
  });
  if (writeReportOutput) {
    writeReport(report, undefined, config.reportRoot);
  }
  return report;
};

const resolveDecisionHash = () => {
  try {
    return hashTree("bench/tasks");
  } catch {
    return "unavailable";
  }
};

export const decisionConstants = {
  decisionRepeats: DECISION_REPEATS,
  judgeCalls: LIVE_JUDGE_CALLS,
  scoutExtraCalls: SCOUT_EXTRA_CALLS,
};
