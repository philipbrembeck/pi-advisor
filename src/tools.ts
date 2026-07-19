import { stream, type Message, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  advisorAutoLoopGateRef, advisorMaxCallsPerSessionRef, advisorBlockOnBlockedRef, advisorCollapseResponsesRef, advisorCompletionGateRef, advisorCustomInvocationRef, advisorFailureGateRef, advisorLoopThresholdRef, advisorPlanGateRef, advisorSessionSummaryRef,
  advisorRef, advisorEffortRef, contextMaxCharsRef, loadConfig, splitRef,
} from "./config.js";
import { recentConversation, textFrom } from "./conversation.js";
import { herdrAdvisorActivity, herdrAdvisorBlock } from "./herdr.js";
import { AdvisorSessionState, type AdvisorVerdict } from "./session-state.js";

export const advisorSessionState = new AdvisorSessionState();

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
  "You do not act or take over planning. Return only a JSON object with verdict (proceed, revise, insufficient-evidence, or blocked), criticalFindings (array of {severity, claim, evidence}), missingEvidence (string array), smallestNextStep (string), verificationRequired (string array), and escalationReason (string or null). Use blocked only for a critical issue requiring the user; never claim verification that the supplied evidence does not show.",
].join(" ");

type Advice = { verdict: AdvisorVerdict; criticalFindings: Array<{ severity: string; claim: string; evidence: string }>; missingEvidence: string[]; smallestNextStep: string; verificationRequired: string[]; escalationReason: string | null };

export const parseAdvice = (text: string): Advice => {
  try {
    const value = JSON.parse(text) as Partial<Advice>;
    if (!["proceed", "revise", "blocked", "insufficient-evidence"].includes(value.verdict ?? "")) throw new Error("invalid verdict");
    if (!Array.isArray(value.criticalFindings) || !Array.isArray(value.missingEvidence) || !Array.isArray(value.verificationRequired) || typeof value.smallestNextStep !== "string" || !value.missingEvidence.every((item) => typeof item === "string") || !value.verificationRequired.every((item) => typeof item === "string") || !value.criticalFindings.every((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).severity === "string" && typeof (item as Record<string, unknown>).claim === "string" && typeof (item as Record<string, unknown>).evidence === "string")) throw new Error("invalid shape");
    return { verdict: value.verdict as AdvisorVerdict, criticalFindings: value.criticalFindings as Advice["criticalFindings"], missingEvidence: value.missingEvidence as string[], smallestNextStep: value.smallestNextStep, verificationRequired: value.verificationRequired as string[], escalationReason: typeof value.escalationReason === "string" ? value.escalationReason : null };
  } catch {
    return { verdict: "insufficient-evidence", criticalFindings: [{ severity: "medium", claim: "Advisor response was not structured", evidence: "The response could not be parsed as the required JSON." }], missingEvidence: [], smallestNextStep: "Request a structured Advisor review before relying on this advice.", verificationRequired: [], escalationReason: null };
  }
};

const adviceForText = (advice: Advice) => [
  `**Verdict: ${advice.verdict}**`,
  ...advice.criticalFindings.map((finding) => `- **${finding.severity}:** ${finding.claim}${finding.evidence ? ` — ${finding.evidence}` : ""}`),
  advice.missingEvidence.length ? `\n**Missing evidence**\n${advice.missingEvidence.map((item) => `- ${item}`).join("\n")}` : "",
  `\n**Smallest next step**\n${advice.smallestNextStep}`,
  advice.verificationRequired.length ? `\n**Required verification**\n${advice.verificationRequired.map((item) => `- ${item}`).join("\n")}` : "",
].filter(Boolean).join("\n");

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
  const structured = parseAdvice(advice);
  return { advice: adviceForText(structured), thinkingText, structured };
};

export const registerAdvisorTool = (pi: ExtensionAPI) => {
  const session = advisorSessionState;

  pi.registerMessageRenderer?.("advisor-loop-call", (message, _options, theme) => {
    const details = message.details as { question?: string } | undefined;
    return renderAdvisorCallBox(details?.question, theme);
  });

  pi.on("session_start", () => {
    session.resetTask();
    herdrAdvisorBlock.clear();
  });

  pi.on("before_agent_start", (_event, ctx) => {
    if (!pi.getActiveTools().includes("ask_advisor")) return;
    loadConfig(ctx);
    const guidelines = advisorInvocationGuidelines();
    const budget = session.remainingAutomaticCalls(advisorMaxCallsPerSessionRef);
    if (budget !== undefined) guidelines.push(`Advisor calls remaining this session: ${budget}.\nReserve calls for material decisions, repeated failures, or final review.`);
    return guidelines.length > 0 ? { systemPrompt: `${ctx.getSystemPrompt()}\n\nAdvisor invocation settings:\n${guidelines.map((rule) => `- ${rule}`).join("\n")}` } : undefined;
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!pi.getActiveTools().includes("ask_advisor")) return;
    loadConfig(ctx);
    if (event.toolName === "ask_advisor" && !session.canUseAutomaticCall(advisorMaxCallsPerSessionRef)) {
      return { block: true, reason: "Advisor call budget exhausted for this session." };
    }
    if (!advisorAutoLoopGateRef) return;
    if (!session.recordToolCall(event.toolName, event.input, advisorLoopThresholdRef)) return;
    let reason = `Advisor loop gate: ${event.toolName} repeated ${advisorLoopThresholdRef} times without a different tool action.`;
    let blockSession = false;
    if (session.canUseAutomaticCall(advisorMaxCallsPerSessionRef)) {
      session.consumeAutomaticCall();
      herdrAdvisorActivity.start();
      pi.sendMessage({
        customType: "advisor-loop-call",
        content: "Automatic Advisor loop review",
        display: true,
        details: { question: `Loop gate: ${event.toolName} repeated ${advisorLoopThresholdRef} times` },
      }, { deliverAs: "steer" });
      try {
        const { advice, structured } = await consult(ctx, `${reason} Review the repeated actions and recommend the smallest safe next step.`);
        session.recordConsultation("automatic", structured.verdict);
        pi.sendMessage({
          customType: "advisor-manual-result",
          content: `Automatic loop-gate Advisor review:\n\n${advice}`,
          display: true,
          details: { advisor: advisorRef, text: advice },
        }, { deliverAs: "steer" });
        if (structured.verdict === "proceed") {
          session.resetRepetition();
          return;
        }
        blockSession = structured.verdict === "blocked";
        if (blockSession) {
          const escalation = structured.escalationReason || structured.smallestNextStep;
          session.block(escalation);
          herdrAdvisorBlock.set(escalation);
        } else {
          reason = "Advisor loop review delivered. Follow its guidance before retrying this command.";
        }
      } catch (error) {
        session.recordConsultation("automatic");
        const message = error instanceof Error ? error.message : String(error);
        reason = `${reason}\nAdvisor loop review failed: ${message}`;
        session.block(reason);
        herdrAdvisorBlock.set(reason);
        blockSession = true;
        if (ctx.hasUI) ctx.ui.notify(`Advisor loop review failed. Session is blocked: ${message}`, "error");
      } finally {
        herdrAdvisorActivity.finish();
      }
    } else {
      reason = `${reason}\nAdvisor loop review was not run because the session call budget is exhausted.`;
      session.block(reason);
      herdrAdvisorBlock.set(reason);
      blockSession = true;
      if (ctx.hasUI) ctx.ui.notify("Advisor loop review was not run because the session call budget is exhausted. Session is blocked.", "error");
    }
    if (blockSession && advisorBlockOnBlockedRef) ctx.abort();
    return { block: true, reason };
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (session.blocked || !advisorSessionSummaryRef) return;
    const summary = session.summary(advisorMaxCallsPerSessionRef);
    if (summary && ctx.hasUI) ctx.ui.notify(summary, "info");
  });

  pi.on("session_shutdown", () => herdrAdvisorBlock.clear());

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
        session.consumeAutomaticCall();
        const { advice, thinkingText, structured } = await consult(ctx, question, signal, (t, tx) => {
          onUpdate?.({
            content: [{ type: "text", text: tx }],
            details: { thinking: t, text: tx, advisor: advisorRef, question },
          });
        });
        session.recordConsultation("executor", structured.verdict);
        if (structured.verdict === "blocked") {
          const reason = structured.escalationReason || structured.smallestNextStep;
          session.block(reason);
          herdrAdvisorBlock.set(reason);
          if (advisorBlockOnBlockedRef) ctx.abort();
        }
        return {
          content: [{ type: "text", text: `Advisor (${advisorRef})\n\n${advice}` }],
          details: { thinking: thinkingText, text: advice, advisor: advisorRef, question, verdict: structured.verdict },
        };
      } finally {
        herdrAdvisorActivity.finish();
      }
    },
  });
};
