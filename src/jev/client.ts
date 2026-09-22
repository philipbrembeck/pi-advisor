import type { EntryType, Fetch, Questions } from "@typesafe-ai/sdk";

import {
  advisorJevModelRef,
  advisorJevPricePerMtokRef,
  advisorJevTimeoutMsRef,
} from "../config/state.ts";
import { redactSecrets } from "../redaction.ts";
import type { JevCredentials, JevTransportKind } from "./transport.ts";

export type JevErrorCategory =
  | "auth"
  | "timeout"
  | "network"
  | "malformed"
  | "error";

/** A classified, redacted Jev failure; never carries key material. */
export class JevFailure extends Error {
  readonly category: JevErrorCategory;

  constructor(category: JevErrorCategory, message: string) {
    super(message);
    this.name = "JevFailure";
    this.category = category;
  }
}

export interface JevUsage {
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

export interface JevAskResult {
  answers: Record<string, unknown>;
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

const RETRYABLE_STATUSES = new Set([408, 429, ...range(500, 599)]);
const RETRY_BACKOFF_MS = 250;
const MAX_ATTEMPTS = 2;

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

const finiteTokens = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

const errorDetail = (error: unknown): string => {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
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

const openRouterModelId = (model: string) =>
  model.includes("/") ? model : `~typesafe/${model}`;

interface AttemptOutcome {
  answers?: Record<string, unknown>;
  failure?: JevFailure;
  model?: string;
  retryable?: boolean;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

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
        // biome-ignore lint/performance/noAwaitInLoops: the retry loop is bounded to one backoff by the deadline controller.
        outcome = await this.#attempt(body, deadline.signal);
        if (!outcome.retryable || attempt >= MAX_ATTEMPTS) {
          break;
        }
        await this.#backoff(deadline.signal);
        if (deadline.signal.aborted) {
          break;
        }
      }
      return this.#settle(outcome, deadlineHit, signal);
    } catch (error) {
      if (signal?.aborted && !deadlineHit) {
        throw error;
      }
      if (error instanceof JevFailure) {
        throw error;
      }
      const message = redactSecrets(
        error instanceof Error ? error.message : String(error)
      );
      throw deadlineHit
        ? new JevFailure(
            "timeout",
            `Jev call exceeded its ${this.#timeoutMs} ms wall-time budget.`
          )
        : new JevFailure("error", message);
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
      throw new JevFailure(
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
    throw new JevFailure("error", "Jev call failed.");
  }

  async #backoff(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, RETRY_BACKOFF_MS);
      timer.unref?.();
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
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
        ...this.#connectionFailure(error),
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

  #connectionFailure(error: unknown): { failure: JevFailure } {
    const message = redactSecrets(
      error instanceof Error ? error.message : String(error)
    );
    return {
      failure: new JevFailure("network", `Jev connection failed: ${message}`),
    };
  }

  async #failureFromStatus(response: Response): Promise<JevFailure> {
    let detail = "";
    try {
      const parsed: unknown = await response.json();
      const error = (parsed as { error?: unknown } | null)?.error;
      detail = errorDetail(error);
    } catch {
      detail = "";
    }
    const message = redactSecrets(
      `Jev ${this.#transportLabel()} request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}.`
    );
    return new JevFailure(statusCategory(response.status), message);
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
        failure: new JevFailure(
          "malformed",
          `Jev response was not JSON: ${redactSecrets(error instanceof Error ? error.message : String(error))}`
        ),
      };
    }
    const record = parsed as {
      answers?: unknown;
      model?: unknown;
      usage?: unknown;
    } | null;
    if (
      !record ||
      typeof record !== "object" ||
      !record.answers ||
      typeof record.answers !== "object"
    ) {
      return {
        failure: new JevFailure(
          "malformed",
          "Jev response did not include an answers object."
        ),
      };
    }
    return {
      answers: record.answers as Record<string, unknown>,
      model: typeof record.model === "string" ? record.model : this.#model,
      usage: record.usage as AttemptOutcome["usage"],
    };
  }

  #result(outcome: AttemptOutcome): JevAskResult {
    const usage = outcome.usage as
      | { input_tokens?: unknown; output_tokens?: unknown }
      | undefined;
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
