import {
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
  stream,
} from "@earendil-works/pi-ai/compat";
import { assertRecordedRequestPin } from "./pins.ts";
import type { ModelPin, RecordedProviderRequest } from "./types.ts";

export class LiveProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveProviderUnavailableError";
  }
}

export interface LiveClientConfig {
  api: Api;
  apiKey: string;
  baseUrl: string;
  provider: string;
  timeoutMs: number;
}

const envValue = (name: string, env: NodeJS.ProcessEnv) => {
  const value = env[name]?.trim();
  return value || undefined;
};

/** Live calls are opt-in and require an explicit endpoint and credential. */
export const readLiveClientConfig = (
  env: NodeJS.ProcessEnv = process.env
): LiveClientConfig => {
  const baseUrl = envValue("BENCH_BASE_URL", env);
  const apiKey =
    envValue("BENCH_API_KEY", env) ?? envValue("OPENAI_API_KEY", env);
  if (!baseUrl) {
    throw new LiveProviderUnavailableError(
      "BENCH_BASE_URL is required for live benchmark tiers."
    );
  }
  if (!apiKey) {
    throw new LiveProviderUnavailableError(
      "BENCH_API_KEY or OPENAI_API_KEY is required for live benchmark tiers."
    );
  }
  const timeoutText = envValue("BENCH_TIMEOUT_MS", env);
  const timeoutMs = timeoutText === undefined ? 120_000 : Number(timeoutText);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("BENCH_TIMEOUT_MS must be a positive safe integer.");
  }
  return {
    api: (envValue("BENCH_API", env) ?? "openai-completions") as Api,
    apiKey,
    baseUrl,
    provider: envValue("BENCH_PROVIDER", env) ?? "openai-codex",
    timeoutMs,
  };
};

export interface LiveTextRequest {
  pin: ModelPin;
  prompt: string;
  signal?: AbortSignal;
  systemPrompt: string;
}

export interface LiveTextResult {
  latencyMs: number;
  request: RecordedProviderRequest;
  text: string;
  usage?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const textFromAssistant = (message: AssistantMessage) =>
  message.content
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text"
    )
    .map((part) => part.text)
    .join("\n");

const effortFromPayload = (payload: Record<string, unknown>) => {
  if (typeof payload.reasoning_effort === "string") {
    return payload.reasoning_effort;
  }
  if (isRecord(payload.reasoning)) {
    return typeof payload.reasoning.effort === "string"
      ? payload.reasoning.effort
      : undefined;
  }
  if (typeof payload.thinking === "string") {
    return payload.thinking;
  }
};

const modelFor = (config: LiveClientConfig, pin: ModelPin): Model<Api> => ({
  api: config.api,
  baseUrl: config.baseUrl,
  compat: { supportsReasoningEffort: true },
  contextWindow: 1_000_000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: pin.model.slice(pin.model.indexOf("/") + 1),
  input: ["text"],
  maxTokens: 16_384,
  name: pin.model,
  provider: config.provider,
  reasoning: true,
});

/**
 * Direct provider client used by live tiers. Every request is recorded from
 * the serialized provider payload and checked against its role pin before the
 * response is accepted.
 */
export class LiveModelClient {
  readonly #config: LiveClientConfig;
  readonly #requests: RecordedProviderRequest[] = [];

  constructor(config: LiveClientConfig) {
    this.#config = config;
  }

  get requests() {
    return [...this.#requests];
  }

  async text({ pin, prompt, signal, systemPrompt }: LiveTextRequest) {
    const model = modelFor(this.#config, pin);
    const messages: Message[] = [
      {
        content: [{ text: prompt, type: "text" }],
        role: "user",
        timestamp: Date.now(),
      },
    ];
    let recorded: RecordedProviderRequest | undefined;
    const started = performance.now();
    const eventStream = stream(model, { messages, systemPrompt }, {
      apiKey: this.#config.apiKey,
      maxRetries: 0,
      onPayload: (payload: unknown, actualModel: Model<Api>) => {
        const body = isRecord(payload) ? payload : {};
        const actualEffort = effortFromPayload(body);
        recorded = {
          effort: actualEffort,
          model: actualModel.id,
          provider: actualModel.provider,
          reasoning: actualEffort,
          role: pin.role,
        };
        assertRecordedRequestPin(recorded, pin);
        return payload;
      },
      reasoningEffort: pin.effort,
      signal,
      timeoutMs: this.#config.timeoutMs,
    } as never);
    const response = await eventStream.result();
    const assistant = [response].find(
      (message): message is AssistantMessage => message.role === "assistant"
    );
    const text = assistant ? textFromAssistant(assistant) : "";
    if (!recorded) {
      throw new Error(`No serialized request was recorded for ${pin.role}.`);
    }
    if (!text.trim()) {
      throw new Error(`Live ${pin.role} model returned no text.`);
    }
    this.#requests.push(recorded);
    return {
      latencyMs: Math.max(0, performance.now() - started),
      request: recorded,
      text,
      usage: assistant?.usage,
    } satisfies LiveTextResult;
  }
}
