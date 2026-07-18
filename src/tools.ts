import { stream, type Message, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  advisorCollapseResponsesRef, advisorCompletionGateRef, advisorCustomInvocationRef, advisorFailureGateRef, advisorPlanGateRef,
  advisorRef, advisorEffortRef, contextMaxCharsRef, loadConfig, splitRef,
} from "./config.js";
import { recentConversation, textFrom } from "./conversation.js";
import { herdrAdvisorActivity } from "./herdr.js";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const resolveAdvisorRequest = (question?: string) => question?.trim() || undefined;
export const advisorMessageText = (conversation: string, question?: string) =>
  `${conversation ? `<conversation>\n${conversation}\n</conversation>` : ""}${question ? `\n\nTargeted focus:\n${question}` : ""}`;

export const renderAdvisorCallBox = (question: string | undefined, theme: any) => {
  const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
  const label = theme.fg("customMessageLabel", theme.bold("[advisor]"));
  const title = theme.fg("customMessageText", "Executor → Advisor");
  box.addChild(new Text(question ? `${label} ${title}\n${theme.fg("dim", `  ${question}`)}` : `${label} ${title}`, 0, 0));
  return box;
};

const COLLAPSED_ADVICE_LINES = 12;

export const adviceForDisplay = (advice: string, expanded: boolean) => {
  if (!advisorCollapseResponsesRef || expanded) return advice;
  const lines = advice.split("\n");
  if (lines.length <= COLLAPSED_ADVICE_LINES) return advice;
  return `${lines.slice(0, COLLAPSED_ADVICE_LINES).join("\n")}\n\n… (${lines.length - COLLAPSED_ADVICE_LINES} more lines, Ctrl+O to expand)`;
};

export const advisorInvocationGuidelines = () => {
  const guidelines: string[] = [];
  if (advisorPlanGateRef) guidelines.push("Before committing to a materially consequential plan, use ask_advisor after investigating and forming your own candidate direction. Use it to stress-test consequential architectural, security, data-loss, compatibility, or difficult-to-reverse decisions. Do not delegate the entire plan or task.");
  if (advisorFailureGateRef) guidelines.push("Use ask_advisor after two consecutive materially equivalent failed attempts, when a fix recreates an earlier failure, or after two actions produce no measurable progress. Do not make another materially equivalent attempt before consulting.");
  if (advisorCompletionGateRef) guidelines.push("Before declaring success, use ask_advisor to review the goal, changed files, key decisions, tests, results, and remaining risks. Skip this only for demonstrably trivial, low-risk work.");
  if (advisorCustomInvocationRef) guidelines.push(`Also use ask_advisor when: ${advisorCustomInvocationRef}`);
  if (guidelines.length > 0) guidelines.push("Call ask_advisor with an empty object by default. Do not invent a question merely to request a review: the Advisor already receives context. Include question only for a genuinely specific assumption or trade-off.");
  return guidelines;
};

export const ADVISOR_SYSTEM = [
  "You are the Advisor: a senior engineer giving a brief second opinion to an autonomous coding agent.",
  "You already have the relevant reconstructed conversation context. No question or other input from the Executor is needed for a general review.",
  "When no targeted focus is supplied, proactively review the task, risks, proposed direction, and validation from the context. Do not ask the Executor for a question, clarification, more input, or confirmation.",
  "The context may be truncated, so state any material uncertainty and make the best recommendation you can from what is present.",
  "You do not act or take over planning. Identify risks, challenge assumptions, and recommend the smallest correct next step. No preamble.",
].join(" ");

export const consult = async (
  ctx: ExtensionContext,
  question?: string,
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
    content: [{ type: "text", text: advisorMessageText(conversation, question) }],
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
  pi.on("before_agent_start", (_event, ctx) => {
    if (!pi.getActiveTools().includes("ask_advisor")) return;
    loadConfig(ctx);
    const guidelines = advisorInvocationGuidelines();
    return guidelines.length > 0 ? { systemPrompt: `${ctx.getSystemPrompt()}\n\nAdvisor invocation settings:\n${guidelines.map((rule) => `- ${rule}`).join("\n")}` } : undefined;
  });

  pi.registerTool({
    name: "ask_advisor",
    label: "Ask Advisor",
    description: "Consult the on-demand Advisor model for strategic guidance. Call with an empty object for a context-aware review; add question only for a genuinely targeted focus.",
    promptSnippet: "Consult the Advisor using its existing context; omit question unless a specific focus is necessary",
    promptGuidelines: [
      "Call ask_advisor with an empty object by default. Do not invent a question merely to request a review: the Advisor already receives the context. Include question only for a genuinely specific assumption or trade-off.",
    ],
    parameters: Type.Object({ question: Type.Optional(Type.String({ description: "The specific question or decision to get advice on. Omit this for normal reviews: the Advisor already has the conversation context." })) }),
    renderShell: "self",
    renderCall(args, theme, _context) {
      return renderAdvisorCallBox(args.question?.trim(), theme);
    },
    renderResult(result, { isPartial, expanded }, theme, context) {
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
        if (d?.text) box.addChild(new Markdown(adviceForDisplay(d.text, Boolean(expanded)), 0, 0, getMarkdownTheme()));
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
        box.addChild(new Markdown(adviceForDisplay(advice, Boolean(expanded)), 0, 0, getMarkdownTheme()));
      }
      return box;
    },
    async execute(_id, params, signal, onUpdate, ctx) {
      const question = resolveAdvisorRequest(params.question);
      herdrAdvisorActivity.start();
      try {
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
      } finally {
        herdrAdvisorActivity.finish();
      }
    },
  });
};
