import type { Fetch } from "@typesafe-ai/sdk";

import type { JsonValue } from "./extension-context.ts";

export interface CapturedJevRequest {
  body: Record<string, JsonValue>;
  headers: Record<string, string>;
  url: string;
}

export interface SystemOneMock {
  captured: CapturedJevRequest[];
  fetch: Fetch;
}

interface StructuredJevResponse {
  body: unknown;
  status: number;
}

const isStructuredJevResponse = (
  entry: unknown
): entry is StructuredJevResponse =>
  entry !== null && typeof entry === "object" && "status" in entry;

/** Injectable fetch returning one canned systemone response per call, with
 * full request capture for privacy canaries. */
export const systemOneMock = (
  responses: unknown[],
  options: { latencyMs?: number } = {}
): SystemOneMock => {
  const captured: CapturedJevRequest[] = [];
  let call = 0;
  const fetch: Fetch = (url, init) =>
    new Promise<Response>((resolve, reject) => {
      captured.push({
        body: JSON.parse(String(init?.body ?? "{}")),
        // SAFETY: mock fetch callers always pass plain header records, never Headers or tuple lists.
        headers: (init?.headers ?? {}) as Record<string, string>,
        url,
      });
      const timer = setTimeout(() => {
        const entry = responses[Math.min(call, responses.length - 1)];
        call += 1;
        const structured = isStructuredJevResponse(entry);
        const status = structured ? entry.status : 200;
        const body = structured ? entry.body : entry;
        resolve(
          Response.json(body ?? {}, {
            headers: { "content-type": "application/json" },
            status,
          })
        );
      }, options.latencyMs ?? 0);
      timer.unref?.();
      init?.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("fetch aborted"));
        },
        { once: true }
      );
    });
  return { captured, fetch };
};

/** Branch entries for recentConversation from [role, text] pairs. */
export const branchFromLines = (lines: [string, string][]) =>
  lines.map(([role, text]) => ({
    message: {
      content: [{ text, type: "text" }],
      role,
    },
    type: "message",
  }));
