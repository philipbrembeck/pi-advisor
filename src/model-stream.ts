import {
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
  stream,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { splitRef } from "./config.js";

export interface ResolvedConfiguredModel {
  apiKey: string;
  env?: Record<string, string>;
  headers?: Record<string, string | null>;
  model: Model<Api>;
  ref: string;
}

export const resolveConfiguredModel = async (
  ctx: ExtensionContext,
  ref: string,
  label: string
): Promise<ResolvedConfiguredModel> => {
  const [provider, modelId] = splitRef(ref);
  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) {
    throw new Error(`${label} model not found: ${ref}`);
  }
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error((auth as { error: string }).error);
  }
  if (!auth.apiKey) {
    throw new Error(`No API key for ${ref}`);
  }
  return {
    apiKey: auth.apiKey,
    env: auth.env,
    headers: auth.headers,
    model,
    ref,
  };
};

export interface CollectTextStreamOptions {
  messages: Message[];
  onChunk?: (thinking: string, text: string) => void;
  reasoning?: string;
  signal?: AbortSignal;
  systemPrompt: string;
}

export interface CollectedTextStream {
  text: string;
  thinking: string;
  usage?: unknown;
}

export const ADVISOR_STREAM_UPDATE_INTERVAL_MS = 90;

export interface CoalescedUpdateResult {
  error?: unknown;
  failed: boolean;
}

export interface CoalescedUpdate<T> {
  cancel: () => void;
  flush: () => CoalescedUpdateResult;
  update: (value: T) => void;
}

export interface CoalescedUpdateScheduler {
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  now: () => number;
  setTimeout: (
    callback: () => void,
    delay: number
  ) => ReturnType<typeof setTimeout>;
}

/**
 * Keep stream updates responsive without forwarding every provider delta to
 * the UI. The first update in a burst is immediate; later updates are kept as
 * the latest value and published at most once per interval. `flush()` closes
 * the publisher and is intended for terminal success/error paths.
 */
export const createCoalescedUpdate = <T>(
  publish: (value: T) => void,
  intervalMs = ADVISOR_STREAM_UPDATE_INTERVAL_MS,
  scheduler: CoalescedUpdateScheduler = {
    clearTimeout,
    now: Date.now,
    setTimeout: (callback, delay) => setTimeout(callback, delay),
  }
): CoalescedUpdate<T> => {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Coalesced update interval must be positive and finite.");
  }

  let closed = false;
  let hasPending = false;
  let pending: T | undefined;
  let lastPublishedAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let publishError: unknown;
  let publishFailed = false;

  const clearTimer = () => {
    if (timer !== undefined) {
      scheduler.clearTimeout(timer);
      timer = undefined;
    }
  };

  const publishPending = () => {
    timer = undefined;
    if (!hasPending) {
      return;
    }
    const value = pending as T;
    pending = undefined;
    hasPending = false;
    lastPublishedAt = scheduler.now();
    try {
      publish(value);
    } catch (error) {
      publishFailed = true;
      publishError = error;
      closed = true;
      clearTimer();
    }
  };

  const schedule = () => {
    const elapsed =
      lastPublishedAt === undefined
        ? intervalMs
        : scheduler.now() - lastPublishedAt;
    const delay = Math.max(0, intervalMs - elapsed);
    if (delay === 0) {
      publishPending();
      return;
    }
    timer = scheduler.setTimeout(publishPending, delay);
    timer.unref?.();
  };

  return {
    cancel: () => {
      closed = true;
      clearTimer();
      pending = undefined;
      hasPending = false;
    },
    flush: () => {
      if (!closed) {
        closed = true;
        clearTimer();
        publishPending();
      }
      return { error: publishError, failed: publishFailed };
    },
    update: (value) => {
      if (closed) {
        return;
      }
      if (publishFailed) {
        throw publishError;
      }
      pending = value;
      hasPending = true;
      if (timer === undefined) {
        schedule();
      }
      if (publishFailed) {
        throw publishError;
      }
    },
  };
};

export const collectTextStream = async (
  resolved: ResolvedConfiguredModel,
  options: CollectTextStreamOptions,
  streamModel: typeof stream = stream
): Promise<CollectedTextStream> => {
  let thinking = "";
  let text = "";
  const eventStream = streamModel(
    resolved.model,
    { messages: options.messages, systemPrompt: options.systemPrompt },
    {
      apiKey: resolved.apiKey,
      env: resolved.env,
      headers: resolved.headers,
      reasoning: options.reasoning as never,
      signal: options.signal,
    }
  );

  for await (const event of eventStream) {
    if (event.type === "thinking_delta") {
      thinking += event.delta;
      options.onChunk?.(thinking, text);
    } else if (event.type === "text_delta") {
      text += event.delta;
      options.onChunk?.(thinking, text);
    }
  }

  const response = await eventStream.result();
  const lastAssistant = [response].find(
    (message): message is AssistantMessage => message.role === "assistant"
  );
  const finalText =
    lastAssistant?.content
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text"
      )
      .map((part) => part.text)
      .join("\n") || text;
  return {
    text: finalText,
    thinking,
    usage: (
      lastAssistant as (AssistantMessage & { usage?: unknown }) | undefined
    )?.usage,
  };
};
