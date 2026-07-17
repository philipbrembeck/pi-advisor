import { stream, type Message, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { advisorRef, advisorEffortRef, loadConfig, splitRef } from "./config.js";
import { recentConversation, textFrom } from "./conversation.js";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const ADVISOR_SYSTEM = [
  "You are the Advisor: a senior engineer consulted by an autonomous coding agent.",
  "You do not act — you advise. Give concise, high-signal guidance: identify risks,",
  "the smallest correct next step, and wrong assumptions. No preamble.",
].join(" ");

export const consult = async (
  ctx: ExtensionContext,
  question: string,
  signal?: AbortSignal,
  onChunk?: (thinking: string, text: string) => void,
) => {
  loadConfig(ctx);
  const [provider, modelId] = splitRef(advisorRef);
  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) throw new Error(`Advisor model not found: ${advisorRef}`);
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error((auth as { error: string }).error);
  if (!auth.apiKey) throw new Error(`No API key for ${advisorRef}`);

  const conversation = recentConversation(ctx);
  const messages: Message[] = [{
    role: "user",
    content: [{ type: "text", text: `${conversation ? `<conversation>\n${conversation}\n</conversation>\n\n` : ""}Question from the Executor:\n${question}` }],
    timestamp: Date.now(),
  }];

  let thinkingText = "";
  let responseText = "";

  const eventStream = stream(model, { systemPrompt: ADVISOR_SYSTEM, messages }, {
    apiKey: auth.apiKey,
    headers: auth.headers,
    env: auth.env,
    signal,
    reasoning: advisorEffortRef as any,
  });

  for await (const event of eventStream) {
    if (event.type === "thinking_delta") {
      thinkingText += event.delta;
      onChunk?.(thinkingText, responseText);
    } else if (event.type === "text_delta") {
      responseText += event.delta;
      onChunk?.(thinkingText, responseText);
    }
  }

  const response = await eventStream.result();
  const lastAssistant = [response].find((m): m is AssistantMessage => m.role === "assistant");
  const advice = lastAssistant?.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim() || responseText;

  if (!advice) throw new Error("Advisor returned no advice.");
  return { advice, thinkingText };
};

export const registerAdvisorTool = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "ask_advisor",
    label: "Ask Advisor",
    description: "Consult the on-demand Advisor model for strategic guidance, a second opinion, or a sanity check.",
    promptSnippet: "Consult the Advisor model for a second opinion",
    promptGuidelines: [
      "You MUST call `ask_advisor` in each of these scenarios:",
      "1. PLAN GATE: You MUST call `ask_advisor` BEFORE selecting or implementing a plan when multiple materially different approaches exist, requirements are ambiguous, or the decision has architectural, security, data-loss, compatibility, or difficult-to-reverse consequences.",
      "2. FAILURE GATE: You MUST call `ask_advisor` after two consecutive materially equivalent failed attempts, when an attempted fix recreates an earlier failure, or when two consecutive actions produce no measurable progress. Do NOT attempt another materially equivalent fix before consulting.",
      "3. COMPLETION GATE: You MUST call `ask_advisor` with the goal, changed files, key decisions, tests performed, results, and remaining risks BEFORE declaring success or calling `goal_complete`. You MAY skip this only for demonstrably trivial, low-risk work with no meaningful trade-offs or failures.",
      "Do NOT use `ask_advisor` for routine decisions outside these three gates.",
    ],
    parameters: Type.Object({ question: Type.String({ description: "The specific question or decision to get advice on." }) }),
    renderShell: "self",
    renderCall(args, theme, context) {
      const box = context.lastComponent instanceof Box ? context.lastComponent : new Box(1, 1);
      box.setBgFn((text) => `\x1b[48;2;25;32;45m${text}\x1b[0m`);
      box.clear();
      if (!context.state.timerId) {
        context.state.timerId = setInterval(() => context.invalidate(), 80);
      }
      const frame = SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
      box.addChild(new Text(`${theme.fg("warning", theme.bold(`◆ ADVISOR ${frame}`))} ${theme.fg("dim", `· ${args.question}`)}`, 0, 0));
      return box;
    },
    renderResult(result, { isPartial }, theme, context) {
      const box = context.lastComponent instanceof Box ? context.lastComponent : new Box(1, 1);
      box.setBgFn((text) => `\x1b[48;2;25;32;45m${text}\x1b[0m`);
      box.clear();
      if (isPartial) {
        if (!context.state.timerId) {
          context.state.timerId = setInterval(() => context.invalidate(), 80);
        }
        const frame = SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
        const d = result.details as { thinking?: string; text?: string } | undefined;
        const lines: string[] = [`${theme.fg("warning", theme.bold(`◆ ADVISOR ${frame}`))} ${theme.fg("dim", "· Working…")}`];
        if (d?.thinking) {
          const snippet = d.thinking.length > 200 ? d.thinking.slice(-200) : d.thinking;
          lines.push(theme.fg("thinkingText", `  💭 ${snippet.replace(/\n/g, " ")}`));
        }
        if (d?.text) lines.push(theme.fg("text", d.text));
        box.addChild(new Text(lines.join("\n"), 0, 0));
      } else {
        if (context.state.timerId) {
          clearInterval(context.state.timerId);
          delete context.state.timerId;
        }
        const d = result.details as { thinking?: string; text?: string } | undefined;
        const lines: string[] = [theme.fg("warning", theme.bold("◆ ADVISOR"))];
        if (d?.thinking) {
          lines.push(theme.fg("thinkingText", `  💭 ${d.thinking.replace(/\n/g, " ").slice(0, 300)}${d.thinking.length > 300 ? "…" : ""}`));
        }
        lines.push(textFrom(result.content) || "(Advisor returned no advice.)");
        box.addChild(new Text(lines.join("\n"), 0, 0));
      }
      return box;
    },
    async execute(_id, params, signal, onUpdate, ctx) {
      const { advice, thinkingText } = await consult(ctx, params.question, signal, (t, tx) => {
        onUpdate?.({
          content: [{ type: "text", text: tx }],
          details: { thinking: t, text: tx, advisor: advisorRef, question: params.question },
        });
      });
      return {
        content: [{ type: "text", text: `Advisor (${advisorRef})\n\n${advice}` }],
        details: { thinking: thinkingText, text: advice, advisor: advisorRef, question: params.question },
      };
    },
  });
};
