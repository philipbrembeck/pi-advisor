import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import type { RecordedProviderRequest } from "../types.ts";

export interface MockReply {
  text: string;
  usage?: {
    cacheRead?: number;
    cacheWrite?: number;
    input?: number;
    output?: number;
    totalTokens?: number;
  };
}

export interface CapturedRequest {
  body: Record<string, unknown>;
  rawBody: string;
  request: RecordedProviderRequest;
}

export interface MockProviderServerOptions {
  replyFor?: (body: Record<string, unknown>) => MockReply | undefined;
}

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 8 * 1024 * 1024) {
        reject(new Error("Mock provider request exceeded 8 MiB."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });

const writeSse = (response: ServerResponse, reply: MockReply) => {
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  });
  const chunks = reply.text.match(/.{1,160}/gs) ?? [""];
  for (const delta of chunks) {
    response.write(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: delta }, index: 0 }],
        id: "bench-replay",
        model: "replay",
        object: "chat.completion.chunk",
      })}\n\n`
    );
  }
  const usage = reply.usage
    ? {
        completion_tokens: reply.usage.output ?? 0,
        prompt_tokens: reply.usage.input ?? 0,
        total_tokens:
          reply.usage.totalTokens ??
          (reply.usage.input ?? 0) + (reply.usage.output ?? 0),
      }
    : undefined;
  response.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
      id: "bench-replay",
      model: "replay",
      object: "chat.completion.chunk",
      ...(usage ? { usage } : {}),
    })}\n\n`
  );
  response.write("data: [DONE]\n\n");
  response.end();
};

export class MockProviderServer {
  readonly #replyFor: MockProviderServerOptions["replyFor"];
  readonly #server: Server;
  readonly #replies: MockReply[] = [];
  readonly #requests: CapturedRequest[] = [];
  #baseUrl: string | undefined;

  constructor(options: MockProviderServerOptions = {}) {
    this.#replyFor = options.replyFor;

    this.#server = createServer(async (request, response) => {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      try {
        const rawBody = await readBody(request);
        const parsed = JSON.parse(rawBody) as Record<string, unknown>;
        const model =
          typeof parsed.model === "string" ? parsed.model : undefined;
        const effort =
          typeof parsed.reasoning_effort === "string"
            ? parsed.reasoning_effort
            : undefined;
        this.#requests.push({
          body: parsed,
          rawBody,
          request: {
            effort,
            model: model ? `bench-replay/${model}` : undefined,
            provider: "bench-replay",
            reasoning_effort: effort,
          },
        });
        writeSse(
          response,
          this.#replyFor?.(parsed) ??
            this.#replies.shift() ?? { text: "Decision: proceed" }
        );
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            error: {
              message: error instanceof Error ? error.message : String(error),
            },
          })
        );
      }
    });
  }

  get baseUrl() {
    if (!this.#baseUrl) {
      throw new Error("Mock provider server is not started.");
    }
    return this.#baseUrl;
  }

  get requests() {
    return [...this.#requests];
  }

  enqueue(...replies: MockReply[]) {
    this.#replies.push(...replies);
  }

  async start() {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.#server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.#server.off("error", onError);
        const address = this.#server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Mock provider did not receive a TCP port."));
          return;
        }
        this.#baseUrl = `http://127.0.0.1:${address.port}/v1`;
        resolve();
      };
      this.#server.once("error", onError);
      this.#server.once("listening", onListening);
      this.#server.listen(0, "127.0.0.1");
    });
    return this;
  }

  async close() {
    if (!this.#baseUrl) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => (error ? reject(error) : resolve()));
    });
    this.#baseUrl = undefined;
  }
}

interface ProviderRegistrar {
  registerProvider: (name: string, config: ProviderConfig) => void;
}

export const registerMockProvider = (
  pi: ProviderRegistrar,
  server: MockProviderServer
) => {
  const config: ProviderConfig = {
    api: "openai-completions",
    apiKey: "bench-replay",
    authHeader: false,
    baseUrl: server.baseUrl,
    models: [
      {
        contextWindow: 128_000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "replay-model",
        input: ["text"],
        maxTokens: 4096,
        name: "Replay model",
        reasoning: true,
      },
    ],
    name: "Benchmark replay mock",
  };
  pi.registerProvider("bench-replay", config);
};
