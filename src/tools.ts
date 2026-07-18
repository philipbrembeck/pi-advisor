import { stream, type Message, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { advisorRef, advisorEffortRef, contextMaxCharsRef, loadConfig, splitRef } from "./config.js";
import { recentConversation, textFrom } from "./conversation.js";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const DEFAULT_ADVISOR_REQUEST = "Review the current task and conversation context. Identify the highest-risk assumption, the smallest correct next step, and any important validation.";

export const resolveAdvisorRequest = (question?: string) => question?.trim() || DEFAULT_ADVISOR_REQUEST;

export const ADVISOR_SYSTEM = [
  "You are the Advisor: a senior engineer giving a brief second opinion to an autonomous coding agent.",
  "You do not act or take over planning. Help the Executor validate its own proposed direction:",
  "identify risks, challenge assumptions, and recommend the smallest correct next step. No preamble.",
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

  const conversation = recentConversation(ctx, contextMaxCharsRef);
  const messages: Message[] = [{
    role: "user",
    content: [{ type: "text", text: `${conversation ? `<conversation>\n${conversation}\n</conversation>\n\n` : ""}Request from the Executor:\n${question}` }],
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
    description: "Consult the on-demand Advisor model for strategic guidance. Call with no arguments for a general review of the current task and conversation, or provide question for targeted advice.",
    promptSnippet: "Consult the Advisor for targeted advice, or call with no arguments for a general task and conversation review",
    promptGuidelines: [
      "You MUST call `ask_advisor` in each of these scenarios:",
      "1. PLAN GATE: Before committing to a materially consequential plan, first investigate and form your own candidate direction. Then call `ask_advisor` to stress-test the decision when multiple approaches exist, requirements are ambiguous, or the decision has architectural, security, data-loss, compatibility, or difficult-to-reverse consequences. Do not delegate the whole plan or task to the Advisor.",
      "2. FAILURE GATE: You MUST call `ask_advisor` after two consecutive materially equivalent failed attempts, when an attempted fix recreates an earlier failure, or when two consecutive actions produce no measurable progress. Do NOT attempt another materially equivalent fix before consulting.",
      "3. COMPLETION GATE: You MUST call `ask_advisor` with the goal, changed files, key decisions, tests performed, results, and remaining risks BEFORE declaring success or calling `goal_complete`. You MAY skip this only for demonstrably trivial, low-risk work with no meaningful trade-offs or failures.",
      "Call `ask_advisor` with an empty object for a general review of the current task and conversation. Provide `question` when you want the Advisor to assess a specific assumption, trade-off, or proposed next step.",
      "Do NOT use `ask_advisor` for routine decisions outside these three gates.",
    ],
    parameters: Type.Object({ question: Type.Optional(Type.String({ description: "The specific question or decision to get advice on. Omit for a general contextual review." })) }),
    renderShell: "self",
    renderCall(args, theme, context) {
      const box = context.lastComponent instanceof Box ? context.lastComponent : new Box(1, 1, (text) => theme.bg("customMessageBg", text));
      box.setBgFn((text) => theme.bg("customMessageBg", text));
      box.clear();
      const request = args.question?.trim();
      const label = theme.fg("customMessageLabel", theme.bold("[advisor]"));
      const title = theme.fg("customMessageText", "Executor → Advisor");
      box.addChild(new Text(request ? `${label} ${title}\n${theme.fg("dim", `  ${request}`)}` : `${label} ${title}`, 0, 0));
      return box;
    },
    renderResult(result, { isPartial }, theme, context) {
      const box = context.lastComponent instanceof Box ? context.lastComponent : new Box(1, 1, (text) => theme.bg("customMessageBg", text));
      box.setBgFn((text) => theme.bg("customMessageBg", text));
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
        box.addChild(new Text(lines.join("\n"), 0, 0));
        if (d?.text) box.addChild(new Markdown(d.text, 0, 0, getMarkdownTheme()));
      } else {
        if (context.state.timerId) {
          clearInterval(context.state.timerId);
          delete context.state.timerId;
        }
        const d = result.details as { thinking?: string; text?: string; advisor?: string } | undefined;
        const lines: string[] = [theme.fg("warning", theme.bold("◆ ADVISOR RESPONSE"))];
        if (d?.advisor) lines.push(theme.fg("dim", `  ${d.advisor}`));
        if (d?.thinking) {
          lines.push(theme.fg("thinkingText", `  💭 ${d.thinking.replace(/\n/g, " ").slice(0, 300)}${d.thinking.length > 300 ? "…" : ""}`));
        }
        const advice = d?.text || textFrom(result.content) || "(Advisor returned no advice.)";
        box.addChild(new Text(lines.join("\n"), 0, 0));
        box.addChild(new Markdown(advice, 0, 0, getMarkdownTheme()));
      }
      return box;
    },
    async execute(_id, params, signal, onUpdate, ctx) {
      const question = resolveAdvisorRequest(params.question);
      const { advice, thinkingText } = await consult(ctx, question, signal, (t, tx) => {
        onUpdate?.({
          content: [{ type: "text", text: tx }],
          details: { thinking: t, text: tx, advisor: advisorRef, question },
        });
      });
      return {
        content: [{ type: "text", text: `Advisor (${advisorRef})\n\n${advice}` }],
        details: { thinking: thinkingText, text: advice, advisor: advisorRef, question },
      };
    },
  });
};
