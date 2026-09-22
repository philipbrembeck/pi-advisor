import type { EntryType, Fetch, Questions } from "@typesafe-ai/sdk";

import {
  advisorJevModelRef,
  advisorJevPricePerMtokRef,
  advisorJevTimeoutMsRef,
} from "../config/state.ts";
import { isNumber, isRecord, isRecordOf, isString } from "../content-utils.ts";
import type { JsonValue, RecordValue } from "../content-utils.ts";
import { redactSecrets } from "../redaction.ts";
import { JevFailureError } from "./failure.ts";
import type { JevErrorCategory } from "./failure.ts";
import type { JevCredentials, JevTransportKind } from "./transport.ts";

export type { JevErrorCategory } from "./failure.ts";
export { JevFailureError as JevFailure } from "./failure.ts";

export interface JevUsage {
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

export interface JevAskResult {
  answers: RecordValue;
  model: string;
  usage: JevUsage;
}

export interface JevClientOptions {
  apiKey: string;
  fetch?: Fetch;
  model: string;
  pricePerMtok?: number;
  timeoutMs: number;
  transport: JevTransportKind;
}

const ENDPOINTS: Record<JevTransportKind, string> = {
  openrouter: "https://openrouter.ai/api/alpha/decisions",
  typesafe: "https://api.typesafe.ai/v1/systemone",
};

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

const RETRYABLE_STATUSES = new Set([408, 429, ...range(500, 599)]);
const RETRY_BACKOFF_MS = 250;
const MAX_ATTEMPTS = 2;

const finiteTokens = (value: JsonValue | undefined): number =>
  isNumber(value) && Number.isFinite(value) && value >= 0 ? value : 0;

const errorDetail = (error: JsonValue | undefined): string => {
  if (isString(error)) {
    return error;
  }
  if (isRecordOf(error) && "message" in error) {
    return String(error.message);
  }
  return "";
};

const statusCategory = (status: number): JevErrorCategory => {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 400 || status === 422) {
    return "malformed";
  }
  return "error";
};

const isObjectLike = <Value>(value: Value): value is Value & object =>
  typeof value === "object";

const openRouterModelId = (model: string) =>
  model.includes("/") ? model : `~typesafe/${model}`;

interface AttemptOutcome {
  answers?: RecordValue;
  failure?: JevFailureError;
  model?: string;
  retryable?: boolean;
  usage?: { input_tokens?: JsonValue; output_tokens?: JsonValue };
}

const connectionFailure = <E>(error: E) => {
  const message = redactSecrets(
    error instanceof Error ? error.message : String(error)
  );
  return {
    failure: new JevFailureError(
      "network",
      `Jev connection failed: ${message}`
    ),
  };
};

const sleepWithAbort = (signal: AbortSignal, ms: number): Promise<void> =>
  // oxlint-disable-next-line promise/avoid-new -- unref-ed abortable retry timer cannot be expressed with async/await.
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

/** One systemone client for both transports with a total wall deadline so
 * retries can never stall a tool call; errors are classified and redacted on
 * every path. */
export class JevClient {
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: Fetch;
  readonly #model: string;
  readonly #pricePerMtok: number | undefined;
  readonly #timeoutMs: number;

  constructor({
    apiKey,
    fetch,
    model,
    pricePerMtok,
    timeoutMs,
    transport,
  }: JevClientOptions) {
    this.#apiKey = apiKey;
    this.#endpoint = ENDPOINTS[transport];
    // SAFETY: the bound global fetch satisfies the SDK Fetch signature; binding keeps the receiver correct.
    this.#fetch = fetch ?? (globalThis.fetch.bind(globalThis) as Fetch);
    this.#model = transport === "openrouter" ? openRouterModelId(model) : model;
    this.#pricePerMtok = pricePerMtok;
    this.#timeoutMs = timeoutMs;
  }

  async ask(
    state: EntryType,
    questions: Questions,
    signal?: AbortSignal
  ): Promise<JevAskResult> {
    const deadline = new AbortController();
    const abortFromCaller = () => deadline.abort(signal?.reason);
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    if (signal?.aborted) {
      abortFromCaller();
    }
    let deadlineHit = false;
    const timer = setTimeout(() => {
      deadlineHit = true;
      deadline.abort(new Error("Jev wall-time budget elapsed"));
    }, this.#timeoutMs);
    timer.unref?.();
    const body = JSON.stringify({
      model: this.#model,
      questions,
      state,
    });
    try {
      let outcome: AttemptOutcome = {};
      for (let attempt = 1; ; attempt += 1) {
        // The retry loop is bounded to one backoff by the deadline controller.
        outcome = await this.#attempt(body, deadline.signal);
        if (!outcome.retryable || attempt >= MAX_ATTEMPTS) {
          break;
        }
        await sleepWithAbort(deadline.signal, RETRY_BACKOFF_MS);
        if (deadline.signal.aborted) {
          break;
        }
      }
      return this.#settle(outcome, deadlineHit, signal);
    } catch (error) {
      if (signal?.aborted && !deadlineHit) {
        throw error;
      }
      if (error instanceof JevFailureError) {
        throw error;
      }
      const message = redactSecrets(
        error instanceof Error ? error.message : String(error)
      );
      throw deadlineHit
        ? new JevFailureError(
            "timeout",
            `Jev call exceeded its ${this.#timeoutMs} ms wall-time budget.`
          )
        : new JevFailureError("error", message);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  #settle(
    outcome: AttemptOutcome,
    deadlineHit: boolean,
    signal: AbortSignal | undefined
  ): JevAskResult {
    if (outcome.answers) {
      return this.#result(outcome);
    }
    if (deadlineHit && outcome.failure?.category !== "auth") {
      throw new JevFailureError(
        "timeout",
        `Jev call exceeded its ${this.#timeoutMs} ms wall-time budget.`
      );
    }
    if (outcome.failure) {
      throw outcome.failure;
    }
    if (signal?.aborted) {
      throw new Error("Jev call aborted by the caller.");
    }
    throw new JevFailureError("error", "Jev call failed.");
  }

  async #attempt(body: string, signal: AbortSignal): Promise<AttemptOutcome> {
    if (signal.aborted) {
      return { retryable: false };
    }
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        body,
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        return { retryable: false };
      }
      return {
        retryable: true,
        ...connectionFailure(error),
      };
    }
    if (response.ok) {
      return this.#parseSuccess(response);
    }
    const failure = await this.#failureFromStatus(response);
    return {
      failure,
      retryable: RETRYABLE_STATUSES.has(response.status),
    };
  }

  async #failureFromStatus(response: Response): Promise<JevFailureError> {
    let detail = "";
    try {
      const parsed: unknown = await response.json();
      const error = isRecord(parsed) ? parsed.error : undefined;
      detail = errorDetail(error);
    } catch {
      detail = "";
    }
    const message = redactSecrets(
      `Jev ${this.#transportLabel()} request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}.`
    );
    return new JevFailureError(statusCategory(response.status), message);
  }

  #transportLabel(): string {
    return this.#endpoint === ENDPOINTS.openrouter ? "OpenRouter" : "TypeSafe";
  }

  async #parseSuccess(response: Response): Promise<AttemptOutcome> {
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (error) {
      return {
        failure: new JevFailureError(
          "malformed",
          `Jev response was not JSON: ${redactSecrets(error instanceof Error ? error.message : String(error))}`
        ),
      };
    }
    if (!isRecord(parsed) || !parsed.answers || !isObjectLike(parsed.answers)) {
      return {
        failure: new JevFailureError(
          "malformed",
          "Jev response did not include an answers object."
        ),
      };
    }
    return {
      // SAFETY: the response contract guarantees an answers object; the shape is re-validated per key by consumers.
      answers: parsed.answers as RecordValue,
      model: isString(parsed.model) ? parsed.model : this.#model,
      usage: isRecordOf(parsed.usage)
        ? {
            input_tokens: parsed.usage.input_tokens,
            output_tokens: parsed.usage.output_tokens,
          }
        : undefined,
    };
  }

  #result(outcome: AttemptOutcome): JevAskResult {
    const { usage } = outcome;
    const inputTokens = finiteTokens(usage?.input_tokens);
    const outputTokens = finiteTokens(usage?.output_tokens);
    const price = this.#pricePerMtok ?? advisorJevPricePerMtokRef;
    return {
      answers: outcome.answers ?? {},
      model: outcome.model ?? this.#model,
      usage: {
        cost: (inputTokens / 1_000_000) * price,
        inputTokens,
        outputTokens,
      },
    };
  }
}

/** A client wired from resolved credentials; reads the live Jev settings per call. */
export const jevClientFromCredentials = (
  credentials: JevCredentials,
  fetch?: Fetch
): JevClient =>
  new JevClient({
    apiKey: credentials.apiKey,
    fetch,
    model: advisorJevModelRef,
    timeoutMs: advisorJevTimeoutMsRef,
    transport: credentials.transport,
  });
