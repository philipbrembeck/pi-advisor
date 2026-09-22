import type { Fetch } from "@typesafe-ai/sdk";

export interface CapturedJevRequest {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  url: string;
}

export interface SystemOneMock {
  captured: CapturedJevRequest[];
  fetch: Fetch;
}

/** Injectable fetch returning one canned systemone response per call, with
 * full request capture for privacy canaries. */
export const systemOneMock = (
  responses: (unknown | { body: unknown; status: number })[],
  options: { latencyMs?: number } = {}
): SystemOneMock => {
  const captured: CapturedJevRequest[] = [];
  let call = 0;
  const fetch: Fetch = (url, init) =>
    new Promise<Response>((resolve, reject) => {
      captured.push({
        body: JSON.parse(String(init?.body ?? "{}")),
        headers: (init?.headers ?? {}) as Record<string, string>,
        url,
      });
      const timer = setTimeout(() => {
        const entry = responses[Math.min(call, responses.length - 1)];
        call += 1;
        const isStructured =
          entry !== null &&
          typeof entry === "object" &&
          "status" in (entry as Record<string, unknown>);
        const status = isStructured
          ? (entry as { status: number }).status
          : 200;
        const body = isStructured ? (entry as { body: unknown }).body : entry;
        resolve(
          new Response(JSON.stringify(body ?? {}), {
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
