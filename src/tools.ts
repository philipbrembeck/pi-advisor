import {
  type AssistantMessage,
  type Message,
  stream,
} from "@earendil-works/pi-ai/compat";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  advisorAutoLoopGateRef,
  advisorBlockOnBlockedRef,
  advisorCollapseResponsesRef,
  advisorCompletionGateRef,
  advisorCustomInvocationRef,
  advisorEffortRef,
  advisorFailureGateRef,
  advisorFailureModeRef,
  advisorLoopThresholdRef,
  advisorMaxCallsPerSessionRef,
  advisorPlanGateRef,
  advisorRef,
  advisorSessionSummaryRef,
  contextMaxCharsRef,
  loadConfig,
  splitRef,
} from "./config.js";
import { recentConversation, textFrom } from "./conversation.js";
import {
  herdrAdvisorActivity,
  herdrAdvisorBlock,
  notifyHerdrAdvisorFailure,
} from "./herdr.js";
import {
  AdvisorSessionState,
  type ConsultationTrigger,
  type GateDecision,
  type GateTrigger,
} from "./session-state.js";

export type {
  AdvisorInvocationRecord,
  ConsultationTrigger,
  GateDecision,
  GateTrigger,
} from "./session-state.js";

export const advisorSessionState = new AdvisorSessionState();

export const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
];
export const resolveAdvisorRequest = (question?: string) =>
  question?.trim() || undefined;
export const advisorMessageText = (conversation: string, question?: string) =>
  `${conversation ? `<conversation>\n${conversation}\n</conversation>` : ""}${question ? `\n\nTargeted focus:\n${question}` : ""}`;

export const renderAdvisorCallBox = (
  question: string | undefined,
  theme: Theme
) => {
  const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
  const label = theme.fg("customMessageLabel", theme.bold("[advisor]"));
  const title = theme.fg("customMessageText", "Executor → Advisor");
  box.addChild(
    new Text(
      question
        ? `${label} ${title}\n${theme.fg("dim", `  ${question}`)}`
        : `${label} ${title}`,
      0,
      0
    )
  );
  return box;
};

const COLLAPSED_ADVICE_LINES = 12;

export const adviceForDisplay = (advice: string, expanded: boolean) => {
  if (!advisorCollapseResponsesRef || expanded) {
    return advice;
  }
  const lines = advice.split("\n");
  if (lines.length <= COLLAPSED_ADVICE_LINES) {
    return advice;
  }
  return `${lines.slice(0, COLLAPSED_ADVICE_LINES).join("\n")}\n\n… (${lines.length - COLLAPSED_ADVICE_LINES} more lines, Ctrl+O to expand)`;
};

export const advisorInvocationGuidelines = () => {
  const guidelines: string[] = [];
  if (advisorPlanGateRef) {
    guidelines.push(
      "Before committing to a materially consequential plan, use ask_advisor after investigating and forming your own candidate direction. Use it to stress-test consequential architectural, security, data-loss, compatibility, or difficult-to-reverse decisions. Do not delegate the entire plan or task."
    );
  }
  if (advisorFailureGateRef) {
    guidelines.push(
      "Use ask_advisor after two consecutive materially equivalent failed attempts, when a fix recreates an earlier failure, or after two actions produce no measurable progress. Do not make another materially equivalent attempt before consulting."
    );
  }
  if (advisorCompletionGateRef) {
    guidelines.push(
      "Before declaring success, use ask_advisor to review the goal, changed files, key decisions, tests, results, and remaining risks. Skip this only for demonstrably trivial, low-risk work."
    );
  }
  if (advisorCustomInvocationRef) {
    guidelines.push(`Also use ask_advisor when: ${advisorCustomInvocationRef}`);
  }
  if (guidelines.length > 0) {
    guidelines.push(
      "Call ask_advisor with an empty object by default. Do not invent a question merely to request a review: the Advisor already receives context. Include question only for a genuinely specific assumption or trade-off."
    );
  }
  return guidelines;
};

export const ADVISOR_SYSTEM = [
  "You are the Advisor: a senior engineer giving a brief second opinion to an autonomous coding agent.",
  "You already have the relevant reconstructed conversation context. No question or other input from the Executor is needed for a general review.",
  "When no targeted focus is supplied, proactively review the task, risks, proposed direction, and validation from the context. Do not ask the Executor for a question, clarification, more input, or confirmation.",
  "The context may be truncated, so state any material uncertainty and make the best recommendation you can from what is present.",
  "You do not act or take over planning. Answer the Executor's request directly in concise, human-readable Markdown. State uncertainty plainly and never claim verification that the supplied evidence does not show.",
].join(" ");

export const ADVISOR_DECISION_SYSTEM = [
  "You are the Advisor's automatic safety gate for a repeated-tool loop.",
  "Review the supplied context and decide whether the Executor may proceed.",
  "Answer in concise Markdown. Your first non-empty line must be exactly `Decision: proceed`, `Decision: revise`, or `Decision: blocked`.",
  "Use blocked only for a critical issue requiring the user. Never claim verification that the supplied evidence does not show.",
].join(" ");

export type GateFailureCategory =
  | "provider-error"
  | "empty-response"
  | "missing-decision"
  | "malformed-decision"
  | "duplicate-decision"
  | "contradictory-decision"
  | "budget-exhausted";
export interface AdvisorGateFailure {
  category: GateFailureCategory;
  markdown?: string;
  message: string;
  ok: false;
}
export interface AdvisorConsultationResult {
  markdown: string;
  model: string;
  thinkingText: string;
  trigger: ConsultationTrigger;
  usage?: unknown;
}
export interface AdvisorGateResult {
  decision: GateDecision;
  markdown: string;
  model: string;
  ok: true;
  thinkingText: string;
  trigger: GateTrigger;
  usage?: unknown;
}
export type AdvisorGateOutcome = AdvisorGateResult | AdvisorGateFailure;

export const advisorUsageCost = (usage: unknown): number | undefined => {
  const value = usage as
    | { cost?: { total?: unknown }; totalCost?: unknown }
    | undefined;
  const cost = value?.cost?.total ?? value?.totalCost;
  return typeof cost === "number" ? cost : undefined;
};

const DECISION_LINE = /^Decision\s*:\s*(proceed|revise|blocked)\s*$/i;
const ANY_DECISION_LINE = /^Decision\s*:\s*(.*?)\s*$/i;
const LINE_BREAK = /\r?\n/;

export const parseAutomaticDecision = (
  text: string
): AdvisorGateResult | AdvisorGateFailure => {
  const lines = text.split(LINE_BREAK);
  const nonEmpty = lines.findIndex((line) => line.trim().length > 0);
  if (nonEmpty === -1) {
    return {
      category: "empty-response",
      message: "Advisor returned an empty gate response.",
      ok: false,
    };
  }
  const first = lines[nonEmpty].trim();
  const match = DECISION_LINE.exec(first);
  if (!match) {
    return {
      category: first.toLowerCase().startsWith("decision:")
        ? "malformed-decision"
        : "missing-decision",
      markdown: text,
      message:
        "Advisor gate response must begin with Decision: proceed, Decision: revise, or Decision: blocked.",
      ok: false,
    };
  }
  const decision = match[1].toLowerCase() as GateDecision;
  for (const line of lines.slice(nonEmpty + 1)) {
    const subsequent = ANY_DECISION_LINE.exec(line.trim());
    if (!subsequent) {
      continue;
    }
    const repeated = subsequent[1].trim().toLowerCase();
    if (repeated === decision) {
      return {
        category: "duplicate-decision",
        markdown: text,
        message: "Advisor gate response contains duplicate decision lines.",
        ok: false,
      };
    }
    return {
      category: "contradictory-decision",
      markdown: text,
      message: "Advisor gate response contains contradictory decision lines.",
      ok: false,
    };
  }
  return {
    decision,
    markdown: text,
    model: "",
    ok: true,
    thinkingText: "",
    trigger: "repeated-tool-call",
  };
};

const adviceForText = (result: AdvisorGateResult) =>
  `**Decision: ${result.decision}**\n\n${result.markdown}`;

const collectAdvisorResponse = async (
  ctx: ExtensionContext,
  systemPrompt: string,
  question: string | undefined,
  signal: AbortSignal | undefined,
  onChunk: ((thinking: string, text: string) => void) | undefined
) => {
  loadConfig(ctx);
  const [provider, modelId] = splitRef(advisorRef);
  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) {
    throw new Error(`Advisor model not found: ${advisorRef}`);
  }
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error((auth as { error: string }).error);
  }
  if (!auth.apiKey) {
    throw new Error(`No API key for ${advisorRef}`);
  }

  const conversation = recentConversation(ctx, contextMaxCharsRef);
  const messages: Message[] = [
    {
      content: [
        { text: advisorMessageText(conversation, question), type: "text" },
      ],
      role: "user",
      timestamp: Date.now(),
    },
  ];

  let thinkingText = "";
  let responseText = "";
  const eventStream = stream(
    model,
    { messages, systemPrompt },
    {
      apiKey: auth.apiKey,
      env: auth.env,
      headers: auth.headers,
      reasoning: advisorEffortRef as never,
      signal,
    }
  );

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
  const lastAssistant = [response].find(
    (m): m is AssistantMessage => m.role === "assistant"
  );
  const markdown =
    lastAssistant?.content
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text"
      )
      .map((part) => part.text)
      .join("\n") || responseText;
  if (!markdown.trim()) {
    throw new Error("Advisor returned no advice.");
  }
  return {
    markdown,
    model: advisorRef,
    thinkingText,
    usage: (
      lastAssistant as (AssistantMessage & { usage?: unknown }) | undefined
    )?.usage,
  };
};

export const consultAdvisor = async (
  ctx: ExtensionContext,
  question?: string,
  signal?: AbortSignal,
  onChunk?: (thinking: string, text: string) => void,
  trigger: ConsultationTrigger = "executor-requested"
): Promise<AdvisorConsultationResult> => {
  const result = await collectAdvisorResponse(
    ctx,
    ADVISOR_SYSTEM,
    question,
    signal,
    onChunk
  );
  return { ...result, trigger };
};

export const runAdvisorGate = async (
  ctx: ExtensionContext,
  question: string,
  trigger: GateTrigger = "repeated-tool-call",
  signal?: AbortSignal,
  onChunk?: (thinking: string, text: string) => void
): Promise<AdvisorGateOutcome> => {
  try {
    const result = await collectAdvisorResponse(
      ctx,
      ADVISOR_DECISION_SYSTEM,
      question,
      signal,
      onChunk
    );
    const parsed = parseAutomaticDecision(result.markdown);
    if (!parsed.ok) {
      return parsed;
    }
    return {
      ...parsed,
      model: result.model,
      thinkingText: result.thinkingText,
      trigger,
      usage: result.usage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      category:
        message === "Advisor returned no advice."
          ? "empty-response"
          : "provider-error",
      message,
      ok: false,
    };
  }
};

const notifyLocalFailure = (
  ctx: ExtensionContext,
  message: string,
  sessionBlocked = false
) => {
  if (ctx.hasUI) {
    ctx.ui.notify(
      `Advisor ${sessionBlocked ? "gate failure; session blocked" : "consultation failed"}: ${message}`,
      "error"
    );
  }
};

export const gateFailureEffectForMode = (
  mode: "block-session" | "block-tool" | "warn-and-continue"
) => {
  if (mode === "warn-and-continue") {
    return "continued" as const;
  }
  return mode === "block-tool"
    ? ("tool-blocked" as const)
    : ("session-blocked" as const);
};

const gateDecisionEffect = (decision: GateDecision) => {
  if (decision === "proceed") {
    return "continued" as const;
  }
  return decision === "blocked"
    ? ("session-blocked" as const)
    : ("tool-blocked" as const);
};

const failureEffect = (
  category: GateFailureCategory,
  message: string,
  ctx: ExtensionContext,
  session: AdvisorSessionState
) => {
  const reason = `Advisor gate ${category}: ${message}`;
  notifyLocalFailure(ctx, message, advisorFailureModeRef === "block-session");
  notifyHerdrAdvisorFailure("Advisor gate failure", reason);
  if (advisorFailureModeRef === "warn-and-continue") {
    return { block: false, effect: "continued" as const, reason };
  }
  if (advisorFailureModeRef === "block-tool") {
    return { block: true, effect: "tool-blocked" as const, reason };
  }
  session.block(reason);
  herdrAdvisorBlock.set(reason);
  if (advisorBlockOnBlockedRef) {
    ctx.abort();
  }
  return { block: true, effect: "session-blocked" as const, reason };
};

export const registerAdvisorTool = (pi: ExtensionAPI) => {
  const session = advisorSessionState;
  const reservedCalls = new Set<string>();

  pi.registerMessageRenderer?.(
    "advisor-loop-call",
    (message, _options, theme) => {
      const details = message.details as { question?: string } | undefined;
      return renderAdvisorCallBox(details?.question, theme);
    }
  );

  pi.registerMessageRenderer?.(
    "advisor-loop-result",
    (message, { expanded }, theme) => {
      const details = message.details as
        | { decision?: GateDecision; text?: string; advisor?: string }
        | undefined;
      const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
      box.addChild(
        new Text(
          theme.fg(
            "warning",
            theme.bold(`◆ ADVISOR GATE: ${details?.decision ?? "failure"}`)
          ),
          0,
          0
        )
      );
      if (details?.advisor) {
        box.addChild(new Text(theme.fg("dim", `  ${details.advisor}`), 0, 0));
      }
      if (details?.text) {
        box.addChild(
          new Markdown(
            adviceForDisplay(details.text, Boolean(expanded)),
            0,
            0,
            getMarkdownTheme()
          )
        );
      } else {
        box.addChild(
          new Text(
            theme.fg(
              "error",
              typeof message.content === "string"
                ? message.content
                : "Advisor gate failed."
            ),
            0,
            0
          )
        );
      }
      return box;
    }
  );

  pi.on("session_start", () => {
    session.resetTask();
    reservedCalls.clear();
    herdrAdvisorBlock.clear();
  });

  pi.on("before_agent_start", (_event, ctx) => {
    if (!pi.getActiveTools().includes("ask_advisor")) {
      return;
    }
    loadConfig(ctx);
    const guidelines = advisorInvocationGuidelines();
    const budget = session.remainingCalls(advisorMaxCallsPerSessionRef);
    if (budget !== undefined) {
      guidelines.push(
        `Advisor calls remaining this session: ${budget}.\nReserve calls for material decisions, repeated failures, or final review.`
      );
    }
    return guidelines.length > 0
      ? {
          systemPrompt: `${ctx.getSystemPrompt()}\n\nAdvisor invocation settings:\n${guidelines.map((rule) => `- ${rule}`).join("\n")}`,
        }
      : undefined;
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!pi.getActiveTools().includes("ask_advisor")) {
      return;
    }
    loadConfig(ctx);
    if (event.toolName === "ask_advisor") {
      if (!session.canConsult(advisorMaxCallsPerSessionRef)) {
        const message = "Advisor call budget exhausted for this session.";
        if (ctx.hasUI) {
          ctx.ui.notify(message, "warning");
        }
        notifyHerdrAdvisorFailure("Advisor budget exhausted", message);
        return { block: true, reason: message };
      }
      session.consumeCall();
      reservedCalls.add(event.toolCallId);
      return;
    }
    if (!advisorAutoLoopGateRef) {
      return;
    }
    if (
      !session.recordToolCall(
        event.toolName,
        event.input,
        advisorLoopThresholdRef
      )
    ) {
      return;
    }
    const reason = `Advisor loop gate: normalized signature for ${event.toolName} repeated ${advisorLoopThresholdRef} times without a materially different tool action.`;
    if (!session.canConsult(advisorMaxCallsPerSessionRef)) {
      const failure = failureEffect(
        "budget-exhausted",
        "Advisor gate call budget is exhausted.",
        ctx,
        session
      );
      return failure.block
        ? { block: true, reason: failure.reason }
        : undefined;
    }
    session.consumeCall();
    herdrAdvisorActivity.start();
    pi.sendMessage(
      {
        content: "Automatic Advisor loop review",
        customType: "advisor-loop-call",
        details: {
          question: `Loop gate: ${event.toolName} repeated ${advisorLoopThresholdRef} times`,
        },
        display: true,
      },
      { deliverAs: "steer" }
    );
    try {
      const result = await runAdvisorGate(
        ctx,
        `${reason} Review the repeated actions and recommend the smallest safe next step.`
      );
      if (!result.ok) {
        session.recordInvocation({
          executionEffect: gateFailureEffectForMode(advisorFailureModeRef),
          failure: result.category,
          kind: "gate",
          model: advisorRef,
          trigger: "repeated-tool-call",
        });
        const failure = failureEffect(
          result.category,
          result.message,
          ctx,
          session
        );
        return failure.block
          ? { block: true, reason: `${reason}\n${failure.reason}` }
          : undefined;
      }
      session.recordInvocation({
        cost: advisorUsageCost(result.usage),
        decision: result.decision,
        executionEffect: gateDecisionEffect(result.decision),
        kind: "gate",
        model: result.model,
        trigger: result.trigger,
        usage: result.usage,
      });
      pi.sendMessage(
        {
          content: adviceForText(result),
          customType: "advisor-loop-result",
          details: {
            advisor: result.model,
            decision: result.decision,
            text: result.markdown,
          },
          display: true,
        },
        { deliverAs: "steer" }
      );
      if (result.decision === "proceed") {
        session.resetRepetition();
        return;
      }
      const gateReason = `Advisor loop review: ${result.markdown}`;
      if (result.decision === "blocked") {
        session.block(gateReason);
        herdrAdvisorBlock.set(gateReason);
        if (advisorBlockOnBlockedRef) {
          ctx.abort();
        }
      }
      return { block: true, reason: gateReason };
    } finally {
      herdrAdvisorActivity.finish();
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (session.blocked || !advisorSessionSummaryRef) {
      return;
    }
    const summary = session.summary(advisorMaxCallsPerSessionRef);
    if (summary && ctx.hasUI) {
      ctx.ui.notify(summary, "info");
    }
  });

  pi.on("session_shutdown", () => {
    reservedCalls.clear();
    herdrAdvisorBlock.clear();
  });

  pi.registerTool({
    description:
      "Consult the on-demand Advisor model for strategic guidance. Call with an empty object for a context-aware review; add question only for a genuinely targeted focus.",
    async execute(_id, params, signal, onUpdate, ctx) {
      if (!reservedCalls.delete(_id)) {
        if (!session.canConsult(advisorMaxCallsPerSessionRef)) {
          throw new Error("Advisor call budget exhausted for this session.");
        }
        session.consumeCall();
      }
      herdrAdvisorActivity.start();
      try {
        const result = await consultAdvisor(
          ctx,
          resolveAdvisorRequest(params.question),
          signal,
          (t, tx) =>
            onUpdate?.({
              content: [{ text: tx, type: "text" }],
              details: {
                advisor: advisorRef,
                question: resolveAdvisorRequest(params.question),
                text: tx,
                thinking: t,
              },
            })
        );
        session.recordInvocation({
          cost: advisorUsageCost(result.usage),
          executionEffect: "continued",
          kind: "markdown",
          model: result.model,
          trigger: "executor-requested",
          usage: result.usage,
        });
        return {
          content: [
            {
              text: `Advisor (${result.model})\n\n${result.markdown}`,
              type: "text",
            },
          ],
          details: {
            advisor: result.model,
            question: resolveAdvisorRequest(params.question),
            text: result.markdown,
            thinking: result.thinkingText,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        session.recordInvocation({
          executionEffect: "continued",
          failure: "provider-error",
          kind: "markdown",
          model: advisorRef,
          trigger: "executor-requested",
        });
        notifyLocalFailure(ctx, message);
        notifyHerdrAdvisorFailure("Advisor consultation failed", message);
        throw error;
      } finally {
        herdrAdvisorActivity.finish();
      }
    },
    label: "Ask Advisor",
    name: "ask_advisor",
    parameters: Type.Object({
      question: Type.Optional(
        Type.String({
          description:
            "The specific question or decision to get advice on. Omit this for normal reviews: the Advisor already has the conversation context.",
        })
      ),
    }),
    promptGuidelines: [
      "Call ask_advisor with an empty object by default. Do not invent a question merely to request a review: the Advisor already receives context. Include question only for a genuinely specific assumption or trade-off.",
    ],
    promptSnippet:
      "Consult the Advisor using its existing context; omit question unless a specific focus is necessary",
    renderCall(args, theme) {
      return renderAdvisorCallBox(args.question?.trim(), theme);
    },
    renderResult(result, { isPartial, expanded }, theme, context) {
      const box =
        context.lastComponent instanceof Box
          ? context.lastComponent
          : new Box(1, 1, (text) => theme.bg("customMessageBg", text));
      box.setBgFn((text) => theme.bg("customMessageBg", text));
      box.clear();
      if (isPartial) {
        if (!context.state.timerId) {
          context.state.timerId = setInterval(() => context.invalidate(), 80);
        }
        const frame =
          SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
        const d = result.details as
          | { thinking?: string; text?: string }
          | undefined;
        const lines: string[] = [
          `${theme.fg("warning", theme.bold(`◆ ADVISOR ${frame}`))} ${theme.fg("dim", "· Working…")}`,
        ];
        if (d?.thinking) {
          lines.push(
            theme.fg(
              "thinkingText",
              `  💭 ${(d.thinking.length > 200 ? d.thinking.slice(-200) : d.thinking).replace(/\n/g, " ")}`
            )
          );
        }
        box.addChild(new Text(lines.join("\n"), 0, 0));
        if (d?.text) {
          box.addChild(
            new Markdown(
              adviceForDisplay(d.text, Boolean(expanded)),
              0,
              0,
              getMarkdownTheme()
            )
          );
        }
      } else {
        if (context.state.timerId) {
          clearInterval(context.state.timerId);
          context.state.timerId = undefined;
        }
        const d = result.details as
          | { thinking?: string; text?: string; advisor?: string }
          | undefined;
        const lines: string[] = [
          theme.fg("warning", theme.bold("◆ ADVISOR RESPONSE")),
        ];
        if (d?.advisor) {
          lines.push(theme.fg("dim", `  ${d.advisor}`));
        }
        if (d?.thinking) {
          lines.push(
            theme.fg(
              "thinkingText",
              `  💭 ${d.thinking.replace(/\n/g, " ").slice(0, 300)}${d.thinking.length > 300 ? "…" : ""}`
            )
          );
        }
        const advice =
          d?.text ||
          textFrom(result.content) ||
          "(Advisor returned no advice.)";
        box.addChild(new Text(lines.join("\n"), 0, 0));
        box.addChild(
          new Markdown(
            adviceForDisplay(advice, Boolean(expanded)),
            0,
            0,
            getMarkdownTheme()
          )
        );
      }
      return box;
    },
    renderShell: "self",
  });
};
