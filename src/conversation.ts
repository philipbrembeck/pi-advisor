import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const textFrom = (content: unknown): string => {
  return (typeof content === "string" ? [content] : Array.isArray(content) ? content : [])
    .map((part: unknown) =>
      typeof part === "string"
        ? part
        : (part as { type?: string; text?: string })?.type === "text"
        ? (part as { text?: string }).text ?? ""
        : ""
    )
    .join("\n")
    .trim();
};

export const recentConversation = (ctx: ExtensionContext, maxChars = 15000): string => {
  if (maxChars === 0) return "";
  const entries: string[] = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message") {
      const msg = entry.message;
      if (msg.role === "user") {
        const text = textFrom(msg.content);
        if (text) entries.push(`User: ${text}`);
      } else if (msg.role === "assistant") {
        const parts: string[] = [];
        const text = textFrom(msg.content);
        if (text) parts.push(text);
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part && typeof part === "object" && part.type === "toolCall") {
              const tc = part as { name?: string; arguments?: unknown };
              const argsStr = JSON.stringify(tc.arguments);
              parts.push(`[Tool Call: ${tc.name}(${argsStr})]`);
            }
          }
        }
        if (parts.length > 0) {
          entries.push(`Executor: ${parts.join("\n")}`);
        }
      } else if (msg.role === "toolResult" || (msg as any).role === "tool") {
        const tr = msg as { toolName?: string; isError?: boolean; content?: unknown };
        const text = textFrom(tr.content);
        const status = tr.isError ? "Error " : "";
        entries.push(`[Tool Result for ${tr.toolName || "unknown"}] (${status}output):\n${text}`);
      }
    } else if (entry.type === "compaction") {
      entries.push(`[System Compaction Summary]: ${entry.summary}`);
    }
  }
  const joined = entries.join("\n\n");
  return joined.length > maxChars ? joined.slice(-maxChars) : joined;
};
