import type {
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
  ClassifierResult,
  ModelsClassifierOptions,
  Usage,
} from "@earendil-works/pi-ai";

import { advisorJevTimeoutMsRef } from "../config/state.ts";
import { isRecordOf, isString } from "../content-utils.ts";
import type { JsonValue } from "../content-utils.ts";
import { JevFailure } from "./failure.ts";
import { nativeScreeningQuestions } from "./questions.ts";
import type { JevState } from "./state.ts";

export type JevQuestionSet = ClassifierContext["questions"];

export interface JevBooleanPolicyAnswer {
  noul: number;
  type: "noul";
}

export interface JevChoicePolicyAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
  type: "choice";
}

export type JevPolicyAnswer = JevBooleanPolicyAnswer | JevChoicePolicyAnswer;

export interface JevAnswers {
  self_answerable?: JevPolicyAnswer;
  should_consult?: JevPolicyAnswer;
  stakes?: JevPolicyAnswer;
}

export interface JevClassifierUsage {
  cost?: number;
  inputTokens: number;
  outputTokens: number;
  piUsage?: Usage;
}

export interface JevClassifierResult {
  answers: JevAnswers;
  model: string;
  usage?: JevClassifierUsage;
}

export interface JevClassifierOptions {
  apiKey?: string;
  signal?: AbortSignal;
}

export interface JevClassifierRegistry {
  classify: (
    model: ClassifierModel<ClassifierApi>,
    context: ClassifierContext,
    options?: ModelsClassifierOptions
  ) => Promise<ClassifierResult>;
  findOfType: (
    type: "classifier",
    provider: string,
    modelId: string
  ) => ClassifierModel<ClassifierApi> | undefined;
}

export interface JevClassifierContext {
  modelRegistry: JevClassifierRegistry;
  signal?: AbortSignal;
}

const REF_PATTERN = /^(?<provider>[^/]+)\/(?<modelId>.+)$/u;

export const parseJevClassifierRef = (ref: string) => {
  const match = REF_PATTERN.exec(ref.trim());

  const provider = match?.groups?.provider;
  const modelId = match?.groups?.modelId;

  return provider && modelId ? { modelId, provider } : undefined;
};

const isClassifierModel = (
  model: unknown
): model is ClassifierModel<ClassifierApi> =>
  isRecordOf(model) &&
  model.type === "classifier" &&
  typeof model.provider === "string" &&
  typeof model.id === "string" &&
  typeof model.api === "string" &&
  isRecordOf(model.cost);

const isProbability = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

const normalizedUsage = (
  usage: Usage | undefined
): JevClassifierUsage | undefined => {
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.input;
  const outputTokens = usage.output;
  const inputCost = usage.cost?.input;
  const cacheReadCost = usage.cost?.cacheRead;
  const cacheWriteCost = usage.cost?.cacheWrite;

  if (
    !Number.isFinite(inputTokens) ||
    inputTokens < 0 ||
    !Number.isFinite(outputTokens) ||
    outputTokens < 0
  ) {
    return undefined;
  }

  const completeCost =
    Number.isFinite(inputCost) &&
    inputCost >= 0 &&
    Number.isFinite(cacheReadCost) &&
    cacheReadCost >= 0 &&
    Number.isFinite(cacheWriteCost) &&
    cacheWriteCost >= 0;

  const cost = completeCost
    ? inputCost + cacheReadCost + cacheWriteCost
    : undefined;

  const piUsage =
    completeCost && cost !== undefined
      ? {
          ...usage,
          cost: {
            ...usage.cost,
            input: inputCost,
            output: 0,
            total: cost,
          },
        }
      : undefined;

  return { cost, inputTokens, outputTokens, piUsage };
};

const abortError = () =>
  new DOMException("Jev classifier call aborted by the caller.", "AbortError");

export const normalizeClassifierAnswers = (
  result: Pick<ClassifierResult, "answers">,
  required: readonly (keyof JevAnswers)[]
): JevAnswers => {
  if (!isRecordOf(result.answers)) {
    throw new JevFailure("malformed", "Classifier returned malformed answers.");
  }

  const answers: JevAnswers = {};

  for (const name of required) {
    const answer = result.answers[name];

    if (
      isRecordOf(answer) &&
      answer.type === "bool" &&
      isProbability(answer.probability)
    ) {
      if (name === "self_answerable" || name === "should_consult") {
        answers[name] = { noul: answer.probability, type: "noul" };
      } else {
        throw new JevFailure(
          "malformed",
          `Classifier returned an unexpected bool answer for ${name}.`
        );
      }

      continue;
    }

    if (isRecordOf(answer) && answer.type === "choice") {
      if (!isRecordOf(answer.probabilities) || !isString(answer.choice)) {
        throw new JevFailure(
          "malformed",
          `Classifier returned malformed ${name} choice.`
        );
      }

      const probabilities: Record<string, number> = {};

      for (const [label, probability] of Object.entries(answer.probabilities)) {
        if (!isProbability(probability)) {
          throw new JevFailure(
            "malformed",
            `Classifier returned an invalid ${name} probability.`
          );
        }

        probabilities[label] = probability;
      }

      if (name === "stakes") {
        const expected = ["high", "moderate", "negligible"];

        const distributionTotal = expected.reduce(
          (sum, label) => sum + (probabilities[label] ?? 0),
          0
        );

        if (
          !expected.includes(answer.choice) ||
          expected.some((label) => !Object.hasOwn(probabilities, label)) ||
          distributionTotal <= 0 ||
          Math.abs(distributionTotal - 1) > 0.05
        ) {
          throw new JevFailure(
            "malformed",
            "Classifier returned an incomplete stakes distribution."
          );
        }

        if (!isProbability(answer.confidence)) {
          throw new JevFailure(
            "malformed",
            "Classifier returned invalid stakes confidence."
          );
        }

        answers.stakes = {
          choice: answer.choice,
          confidence: answer.confidence,
          probabilities,
          type: "choice",
        };
      } else {
        throw new JevFailure(
          "malformed",
          `Classifier returned unsupported choice answer for ${name}.`
        );
      }

      continue;
    }

    throw new JevFailure(
      "malformed",
      `Classifier omitted or invalidated ${name}.`
    );
  }

  return answers;
};

const classifyWithinDeadline = async (
  ctx: JevClassifierContext,
  model: ClassifierModel<ClassifierApi>,
  state: JevState,
  questions: JevQuestionSet,
  options: JevClassifierOptions,
  timeoutMs: number
): Promise<ClassifierResult> => {
  const controller = new AbortController();
  const callerSignal = options.signal ?? ctx.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) {
    throw abortError();
  }

  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timeout = setTimeout(() => {
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }, timeoutMs);

  const apiOptions: ModelsClassifierOptions = {
    maxRetries: 0,
    signal: controller.signal,
    timeoutMs,
  };

  if (options.apiKey !== undefined) {
    apiOptions.apiKey = options.apiKey;
  }

  let abortListener: (() => void) | undefined;

  try {
    // SAFETY: JevState contains only JSON-compatible, redacted strings and its fixed role field.
    const classification = ctx.modelRegistry.classify(
      model,
      { questions, state: state as Record<string, JsonValue> },
      apiOptions
    );

    const aborted = Promise.withResolvers<never>();
    abortListener = () => {
      aborted.reject(controller.signal.reason ?? abortError());
    };

    controller.signal.addEventListener("abort", abortListener, { once: true });

    const request = Promise.race([classification, aborted.promise]);

    return await request;
  } catch (error) {
    if (callerSignal?.aborted) {
      throw error;
    }

    if (controller.signal.aborted) {
      throw new JevFailure(
        "timeout",
        `Jev classifier timed out after ${timeoutMs}ms.`
      );
    }

    if (error instanceof JevFailure) {
      throw error;
    }

    throw new JevFailure("error", "Jev classifier request failed.");
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);

    if (abortListener) {
      controller.signal.removeEventListener("abort", abortListener);
    }
  }
};

export const classifyWithJev = async (
  ctx: JevClassifierContext,
  ref: string,
  state: JevState,
  questions: JevQuestionSet,
  options: JevClassifierOptions = {}
): Promise<JevClassifierResult> => {
  const parsed = parseJevClassifierRef(ref);

  if (!parsed) {
    throw new JevFailure("malformed", "No Jev classifier is selected.");
  }

  const model = ctx.modelRegistry.findOfType(
    "classifier",
    parsed.provider,
    parsed.modelId
  );

  if (!isClassifierModel(model)) {
    throw new JevFailure("error", `Selected classifier ${ref} is unavailable.`);
  }

  const timeoutMs = Math.max(1, advisorJevTimeoutMsRef);

  const result = await classifyWithinDeadline(
    ctx,
    model,
    state,
    questions,
    options,
    timeoutMs
  );

  const stopped = result.stopReason !== "stop";

  if (stopped) {
    throw new JevFailure(
      "error",
      `Jev classifier stopped: ${result.stopReason}.`
    );
  }

  return {
    // SAFETY: caller questions are built from the fixed Jev policy sets.
    answers: normalizeClassifierAnswers(
      result,
      Object.keys(questions) as (keyof JevAnswers)[]
    ),
    model: `${result.provider}/${result.model}`,
    usage: normalizedUsage(result.usage),
  };
};

export const classifyScreening = (
  ctx: JevClassifierContext,
  ref: string,
  state: JevState,
  options?: JevClassifierOptions
) => classifyWithJev(ctx, ref, state, nativeScreeningQuestions, options);

export const classifyTurnGate = (
  ctx: JevClassifierContext,
  ref: string,
  state: JevState,
  options?: JevClassifierOptions
) =>
  classifyWithJev(
    ctx,
    ref,
    state,
    {
      should_consult: {
        criteria: {
          false:
            "The executor is progressing soundly on work that matches the user's intent; interrupting would add nothing material.",
          true: "The executor is approaching a material decision, repeating a failure, about to claim success without validation, or drifting from the user's intent; a second opinion now would change what happens next.",
        },
        instructions:
          "Should a senior engineering advisor be consulted right now, before the executor continues? Judge from `recent_conversation`.",
        type: "bool",
      },
    },
    options
  );
