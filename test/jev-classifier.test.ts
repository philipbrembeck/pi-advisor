import { afterEach, describe, expect, test } from "bun:test";

import type {
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
  ClassifierResult,
  Usage,
} from "@earendil-works/pi-ai";
import { calculateCost } from "@earendil-works/pi-ai";

import { setAdvisorJevTimeoutMsRef } from "../src/config/state.ts";
import {
  classifyWithJev,
  normalizeClassifierAnswers,
  parseJevClassifierRef,
} from "../src/jev/classifier.ts";
import type {
  JevClassifierContext,
  JevClassifierRegistry,
  JevQuestionSet,
} from "../src/jev/classifier.ts";
import { JevFailure } from "../src/jev/failure.ts";
import {
  composeScreeningVerdict,
  composeTurnGateVerdict,
  nativeScreeningQuestions,
  nativeTurnGateQuestion,
} from "../src/jev/questions.ts";
import type { JevState } from "../src/jev/state.ts";

const model = {
  api: "typesafe-classifier",
  baseUrl: "https://classifier.example.test",
  contextWindow: 1000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 2, output: 4 },
  id: "jev-latest",
  input: ["text"],
  name: "Jev Test",
  provider: "typesafe",
  type: "classifier",
} satisfies ClassifierModel<"typesafe-classifier">;

const makeUsage = (selectedModel: ClassifierModel<ClassifierApi>): Usage => {
  const result: Usage = {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 12,
    output: 0,
    totalTokens: 12,
  };

  calculateCost(selectedModel, result);

  return result;
};

const successfulResult = (
  overrides: Partial<ClassifierResult> = {},
  selectedModel: ClassifierModel<ClassifierApi> = model
): ClassifierResult => ({
  answers: {
    self_answerable: { probability: 0.9, type: "bool" },
    stakes: {
      choice: "negligible",
      confidence: 0.95,
      probabilities: { high: 0.01, moderate: 0.04, negligible: 0.95 },
      type: "choice",
    },
  },
  api: "typesafe-classifier",
  model: selectedModel.id,
  provider: selectedModel.provider,
  stopReason: "stop",
  timestamp: 0,
  usage: makeUsage(selectedModel),
  ...overrides,
});

interface CapturedCall {
  context: ClassifierContext;
  model: ClassifierModel<ClassifierApi>;
  options: NonNullable<Parameters<JevClassifierRegistry["classify"]>[2]>;
}

const harness = (
  classifier: JevClassifierRegistry["classify"],
  resolveModel: (
    provider: string,
    id: string
  ) => ClassifierModel<ClassifierApi> | undefined = (provider, id) =>
    provider === model.provider && id === model.id ? model : undefined
) => {
  const calls: CapturedCall[] = [];

  const registry = {
    classify: async (
      selectedModel: ClassifierModel<ClassifierApi>,
      context: ClassifierContext,
      options?: Parameters<JevClassifierRegistry["classify"]>[2]
    ) => {
      calls.push({ context, model: selectedModel, options: options ?? {} });

      return classifier(selectedModel, context, options);
    },
    findOfType: (_type: "classifier", provider: string, id: string) =>
      resolveModel(provider, id),
  } satisfies JevClassifierRegistry;

  const ctx: JevClassifierContext = { modelRegistry: registry };

  return { calls, ctx };
};

const state: JevState = {
  executor_question: "Should we proceed?",
  role: "executor",
};

const questions: JevQuestionSet = nativeScreeningQuestions;

afterEach(() => setAdvisorJevTimeoutMsRef(8000));

describe("Jev Pi classifier adapter", () => {
  test("parses canonical provider/model refs without collapsing model IDs", () => {
    expect(parseJevClassifierRef("openrouter/typesafe/jev-latest")).toEqual({
      modelId: "typesafe/jev-latest",
      provider: "openrouter",
    });
    expect(parseJevClassifierRef("missing-slash")).toBeUndefined();
  });

  test("normalizes bool and stakes distributions while retaining selection and usage", async () => {
    const h = harness(async () => successfulResult());

    const result = await classifyWithJev(
      h.ctx,
      "typesafe/jev-latest",
      state,
      questions
    );

    expect(result.answers.self_answerable).toEqual({ noul: 0.9, type: "noul" });
    expect(result.answers.stakes).toMatchObject({
      probabilities: { high: 0.01, moderate: 0.04, negligible: 0.95 },
      type: "choice",
    });
    expect(result.model).toBe("typesafe/jev-latest");
    expect(result.usage).toMatchObject({
      cost: makeUsage(model).cost.total,
      inputTokens: 12,
      outputTokens: 0,
    });
    expect(h.calls[0]?.model).toBe(model);
    expect(h.calls[0]?.context.state).toEqual(state);
  });

  test("normalized bool and choice answers preserve screening/gate threshold policy", () => {
    const screening = normalizeClassifierAnswers(successfulResult(), [
      "self_answerable",
      "stakes",
    ]);

    expect(
      composeScreeningVerdict(screening, {
        noulMargin: 0.35,
        skipConfidence: 0.85,
      })
    ).toEqual({ skip: true });

    const gateQuestions = { should_consult: nativeTurnGateQuestion };

    const gateAnswers = normalizeClassifierAnswers(
      successfulResult({
        answers: { should_consult: { probability: 0.8, type: "bool" } },
      }),
      ["should_consult"]
    );

    expect(Object.keys(gateQuestions)).toEqual(["should_consult"]);
    expect(composeTurnGateVerdict(gateAnswers, 0.8)).toBe(true);
    expect(composeTurnGateVerdict(gateAnswers, 0.81)).toBe(false);
  });

  test("passes explicit API key only when provided and disables provider retries", async () => {
    const h = harness(async () => successfulResult());
    await classifyWithJev(h.ctx, "typesafe/jev-latest", state, questions, {
      apiKey: "new-explicit-key",
    });
    await classifyWithJev(h.ctx, "typesafe/jev-latest", state, questions);

    expect(h.calls[0]?.options).toMatchObject({
      apiKey: "new-explicit-key",
      maxRetries: 0,
    });
    expect(h.calls[1]?.options).not.toHaveProperty("apiKey");
    expect(h.calls[1]?.options).toMatchObject({ maxRetries: 0 });
  });

  test("uses selected catalog pricing and preserves explicit zero and missing usage", async () => {
    const paidResult = successfulResult();

    const alteredModel = {
      ...model,
      cost: { ...model.cost, input: 3 },
    } satisfies ClassifierModel<"typesafe-classifier">;

    const alteredResult = successfulResult({}, alteredModel);

    const zeroModel = {
      ...model,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    } satisfies ClassifierModel<"typesafe-classifier">;

    const zeroResult = successfulResult({}, zeroModel);

    expect(paidResult.usage?.cost.total).toBe(0.000024);
    expect(paidResult.usage?.cost.output).toBe(0);
    expect(alteredResult.usage?.cost.total).toBe(0.000036);

    const higherOutputOnly = {
      ...model,
      cost: { ...model.cost, output: 50 },
    } satisfies ClassifierModel<"typesafe-classifier">;

    expect(successfulResult({}, higherOutputOnly).usage?.cost.total).toBe(
      0.000024
    );
    expect(successfulResult({}, higherOutputOnly).usage?.cost.output).toBe(0);

    expect(zeroResult.usage?.cost.total).toBe(0);

    const paid = harness(async () => paidResult);

    const response = await classifyWithJev(
      paid.ctx,
      "typesafe/jev-latest",
      state,
      questions
    );

    expect(response.usage?.cost).toBe(paidResult.usage?.cost.total);

    const zero = harness(
      async () => zeroResult,
      () => zeroModel
    );

    const zeroResponse = await classifyWithJev(
      zero.ctx,
      "typesafe/jev-latest",
      state,
      questions
    );

    expect(zeroResponse.usage?.cost).toBe(0);

    const incompleteResult = successfulResult();

    if (incompleteResult.usage) {
      incompleteResult.usage.cost.input = Number.NaN;
    }

    const incomplete = harness(async () => incompleteResult);

    const incompleteResponse = await classifyWithJev(
      incomplete.ctx,
      "typesafe/jev-latest",
      state,
      questions
    );

    expect(incompleteResponse.usage).toMatchObject({ inputTokens: 12 });
    expect(incompleteResponse.usage?.cost).toBeUndefined();
    expect(incompleteResponse.usage?.piUsage).toBeUndefined();

    const missing = harness(async () => successfulResult({ usage: undefined }));

    const missingResponse = await classifyWithJev(
      missing.ctx,
      "typesafe/jev-latest",
      state,
      questions
    );

    expect(missingResponse.usage).toBeUndefined();
  });

  test("fails closed at adapter boundary for malformed or incomplete answers", () => {
    expect(() =>
      normalizeClassifierAnswers(
        successfulResult({
          answers: {
            self_answerable: { probability: 1.01, type: "bool" },
            stakes: {
              choice: "negligible",
              confidence: 0.9,
              probabilities: { high: 0, moderate: 0, negligible: 1 },
              type: "choice",
            },
          },
        }),
        ["self_answerable", "stakes"]
      )
    ).toThrow(JevFailure);

    expect(() =>
      normalizeClassifierAnswers(
        successfulResult({
          answers: {
            self_answerable: { probability: 0.9, type: "bool" },
            stakes: {
              choice: "negligible",
              confidence: 0.9,
              probabilities: { negligible: 1 },
              type: "choice",
            },
          },
        }),
        ["self_answerable", "stakes"]
      )
    ).toThrow("incomplete stakes distribution");
  });

  test("turns non-stop results into failures and never retries in the adapter", async () => {
    const h = harness(async () =>
      successfulResult({
        answers: {},
        errorMessage: "provider error",
        stopReason: "error",
      })
    );

    await expect(
      classifyWithJev(h.ctx, "typesafe/jev-latest", state, questions)
    ).rejects.toThrow("stopped: error");
    expect(h.calls).toHaveLength(1);
  });

  test("caller abort rejects promptly and is not disguised as outage", async () => {
    const started = Promise.withResolvers<boolean>();

    const h = harness((_model, _context, options) => {
      started.resolve(true);
      const signal = options?.signal;

      if (!signal) {
        throw new Error("The classifier adapter must pass an abort signal.");
      }

      return new Promise<ClassifierResult>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    });

    const controller = new AbortController();

    const pending = classifyWithJev(
      h.ctx,
      "typesafe/jev-latest",
      state,
      questions,
      { signal: controller.signal }
    );

    await started.promise;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  test("deadline bounds hanging providers and returns a typed timeout", async () => {
    setAdvisorJevTimeoutMsRef(10);
    const h = harness(async () => new Promise<ClassifierResult>(() => {}));

    await expect(
      classifyWithJev(h.ctx, "typesafe/jev-latest", state, questions)
    ).rejects.toMatchObject({ category: "timeout" });
    expect(h.calls[0]?.options).toMatchObject({ maxRetries: 0, timeoutMs: 10 });
  });

  test("missing model and malformed selection fail before calling classify", async () => {
    const h = harness(async () => successfulResult());

    await expect(
      classifyWithJev(h.ctx, "missing/model", state, questions)
    ).rejects.toThrow("unavailable");
    await expect(
      classifyWithJev(h.ctx, "invalid", state, questions)
    ).rejects.toThrow("No Jev classifier");
    expect(h.calls).toHaveLength(0);
  });
});
