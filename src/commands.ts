import {
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import {
  advisorAutoLoopGateRef,
  advisorBlockOnBlockedRef,
  advisorCollapseResponsesRef,
  advisorCompletionGateRef,
  advisorCustomInvocationRef,
  advisorEffortRef,
  advisorFailureGateRef,
  advisorFailureModeRef,
  advisorHerdrIntegrationRef,
  advisorLoopThresholdRef,
  advisorMaxCallsPerSessionRef,
  advisorPlanGateRef,
  advisorRef,
  advisorSessionSummaryRef,
  advisorToolResultMaxBytesRef,
  advisorToolResultMaxLinesRef,
  contextMaxCharsRef,
  executorEffortRef,
  executorRef,
  loadConfig,
  parseArgs,
  saveConfig,
  setAdvisorAutoLoopGateRef,
  setAdvisorBlockOnBlockedRef,
  setAdvisorCollapseResponsesRef,
  setAdvisorCompletionGateRef,
  setAdvisorCustomInvocationRef,
  setAdvisorEffortRef,
  setAdvisorFailureGateRef,
  setAdvisorFailureModeRef,
  setAdvisorHerdrIntegrationRef,
  setAdvisorLoopThresholdRef,
  setAdvisorMaxCallsPerSessionRef,
  setAdvisorPlanGateRef,
  setAdvisorRef,
  setAdvisorSessionSummaryRef,
  setAdvisorToolResultMaxBytesRef,
  setAdvisorToolResultMaxLinesRef,
  setContextMaxCharsRef,
  setExecutorEffortRef,
  setExecutorRef,
  splitRef,
} from "./config.js";
import { herdrAdvisorActivity, notifyHerdrAdvisorFailure } from "./herdr.js";
import {
  adviceForDisplay,
  advisorSessionState,
  consultAdvisor,
  renderAdvisorCallBox,
  resolveAdvisorRequest,
} from "./tools.js";
import {
  type AdvisorSettings,
  AdvisorSettingsSelector,
  type ContextPreset,
  SearchableModelSelector,
} from "./ui.js";

const EFFORT_LEVELS = [
  "Default (Model Default)",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const CONTEXT_PRESETS: ContextPreset[] = [
  {
    description:
      "No conversation history. The Advisor receives only its standing instructions.",
    label: "0",
    value: 0,
  },
  {
    description: "The most recent 10,000 characters of the current branch.",
    label: "10k",
    value: 10_000,
  },
  {
    description: "The most recent 25,000 characters of the current branch.",
    label: "25k",
    value: 25_000,
  },
  {
    description: "The most recent 100,000 characters of the current branch.",
    label: "100k",
    value: 100_000,
  },
  {
    description: "The most recent 200,000 characters of the current branch.",
    label: "200k",
    value: 200_000,
  },
  {
    description:
      "The complete reconstructed conversation branch. Cost and model context limits apply.",
    label: "ALL",
    value: Number.MAX_SAFE_INTEGER,
  },
];

type ManualConsult = (
  ctx: ExtensionContext,
  question?: string,
  signal?: AbortSignal
) => Promise<{ markdown: string; thinkingText: string }>;

export const registerCommands = (
  pi: ExtensionAPI,
  dependencies: { consult?: ManualConsult } = {}
) => {
  const flowEnabled = () => pi.getActiveTools().includes("ask_advisor");
  const requestAdvisor =
    dependencies.consult ??
    ((ctx, question, signal) =>
      consultAdvisor(ctx, question, signal, undefined, "manual"));
  const manualConsultations = new Set<AbortController>();

  pi.registerEntryRenderer?.(
    "advisor-manual-call",
    (entry, _options, theme) => {
      const { question } = (entry.data ?? {}) as { question?: string };
      return renderAdvisorCallBox(question, theme);
    }
  );

  pi.registerMessageRenderer?.(
    "advisor-manual-result",
    (message, { expanded }, theme) => {
      const details = message.details as
        | { advisor?: string; text?: string }
        | undefined;
      const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
      box.addChild(
        new Text(theme.fg("warning", theme.bold("◆ ADVISOR RESPONSE")), 0, 0)
      );
      if (details?.advisor) {
        box.addChild(new Text(theme.fg("dim", `  ${details.advisor}`), 0, 0));
      }
      const advice =
        details?.text ??
        (typeof message.content === "string"
          ? message.content
          : "(Advisor returned no advice.)");
      box.addChild(
        new Markdown(
          adviceForDisplay(advice, expanded),
          0,
          0,
          getMarkdownTheme()
        )
      );
      return box;
    }
  );

  pi.on("session_shutdown", () => {
    for (const controller of manualConsultations) {
      controller.abort();
    }
    manualConsultations.clear();
    herdrAdvisorActivity.clear();
  });

  pi.registerCommand("advisor-manual", {
    description:
      "Consult the Advisor in parallel; accepts an optional focused question and fans its response out to the Executor",
    handler: async (args, ctx) => {
      loadConfig(ctx);
      if (!advisorSessionState.canConsult(advisorMaxCallsPerSessionRef)) {
        const message = "Advisor call budget exhausted for this session.";
        if (ctx.hasUI) {
          ctx.ui.notify(message, "warning");
        }
        notifyHerdrAdvisorFailure("Advisor budget exhausted", message);
        return;
      }
      advisorSessionState.consumeCall();
      const question = resolveAdvisorRequest(args);
      // A single visible progress surface avoids competing consultations overwriting
      // each other's streamed state. A newer manual request replaces the previous one.
      for (const pending of manualConsultations) {
        pending.abort();
      }
      manualConsultations.clear();
      const controller = new AbortController();
      manualConsultations.add(controller);
      pi.appendEntry?.("advisor-manual-call", { question });

      herdrAdvisorActivity.start();
      void requestAdvisor(ctx, question, controller.signal)
        .then(({ markdown }) => {
          advisorSessionState.recordInvocation({
            executionEffect: "continued",
            kind: "markdown",
            model: advisorRef,
            trigger: "manual",
          });
          const advice = markdown;
          if (controller.signal.aborted) {
            return;
          }
          pi.sendMessage(
            {
              content: `Manual Advisor consultation${question ? ` (${question})` : ""}:\n\n${advice}`,
              customType: "advisor-manual-result",
              details: { advisor: advisorRef, question, text: advice },
              display: true,
            },
            {
              // Steer lets the current turn finish its active work; the Executor sees
              // the result before its next model call rather than being interrupted.
              deliverAs: "steer",
              triggerTurn: true,
            }
          );
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          const message =
            error instanceof Error ? error.message : String(error);
          advisorSessionState.recordInvocation({
            executionEffect: "continued",
            failure: "provider-error",
            kind: "markdown",
            model: advisorRef,
            trigger: "manual",
          });
          if (ctx.hasUI) {
            ctx.ui.notify(`Advisor consultation failed: ${message}`, "error");
          }
          notifyHerdrAdvisorFailure("Advisor consultation failed", message);
        })
        .finally(() => {
          manualConsultations.delete(controller);
          herdrAdvisorActivity.finish();
        });
    },
  });

  pi.registerCommand("advisor", {
    description:
      "Enable the Executor/Advisor flow and switch to the configured Executor model; accepts contextMaxChars=N",
    handler: async (args, ctx) => {
      loadConfig(ctx);
      const argumentError = parseArgs(args);
      if (argumentError) {
        if (ctx.hasUI) {
          ctx.ui.notify(argumentError, "error");
        }
        return;
      }
      const [provider, modelId] = splitRef(executorRef);
      const executor = ctx.modelRegistry.find(provider, modelId);
      if (!executor) {
        return ctx.hasUI
          ? ctx.ui.notify(`Executor model not found: ${executorRef}`, "error")
          : undefined;
      }
      const [ap, am] = splitRef(advisorRef);
      if (!ctx.modelRegistry.find(ap, am)) {
        return ctx.hasUI
          ? ctx.ui.notify(`Advisor model not found: ${advisorRef}`, "error")
          : undefined;
      }
      if (!(await pi.setModel(executor))) {
        return ctx.hasUI
          ? ctx.ui.notify(`No API key for Executor ${executorRef}`, "error")
          : undefined;
      }
      if (executorEffortRef) {
        pi.setThinkingLevel(executorEffortRef as any);
      }
      if (!flowEnabled()) {
        pi.setActiveTools([...pi.getActiveTools(), "ask_advisor"]);
      }
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Advisor flow ready — Executor: ${executorRef} (thinking: ${executorEffortRef || "default"}) · Advisor: ${advisorRef} (thinking: ${advisorEffortRef || "default"})`,
          "info"
        );
      }
    },
  });

  pi.registerCommand("advisor-models", {
    description:
      "Select and persist the Executor and Advisor models with reasoning levels",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }
      const refs = ctx.modelRegistry
        .getAvailable()
        .map((m) => `${m.provider}/${m.id}`);

      const executor = await ctx.ui.custom<string | undefined>(
        (tui, theme, keybindings, done) =>
          new SearchableModelSelector({
            allOptions: refs,
            keybindings,
            onCancel: () => done(undefined),
            onSelect: done,
            theme,
            title: "Select Executor Model",
            tui,
          })
      );
      if (!executor) {
        return;
      }

      const executorEffort = await ctx.ui.select(
        "Select Executor Reasoning/Thinking Level",
        EFFORT_LEVELS
      );
      if (!executorEffort) {
        return;
      }

      const advisor = await ctx.ui.custom<string | undefined>(
        (tui, theme, keybindings, done) =>
          new SearchableModelSelector({
            allOptions: refs,
            keybindings,
            onCancel: () => done(undefined),
            onSelect: done,
            theme,
            title: "Select Advisor Model",
            tui,
          })
      );
      if (!advisor) {
        return;
      }

      const advisorEffort = await ctx.ui.select(
        "Select Advisor Reasoning/Thinking Level",
        EFFORT_LEVELS
      );
      if (!advisorEffort) {
        return;
      }

      setExecutorRef(executor);
      setAdvisorRef(advisor);
      setExecutorEffortRef(
        executorEffort === "Default (Model Default)"
          ? undefined
          : executorEffort
      );
      setAdvisorEffortRef(
        advisorEffort === "Default (Model Default)" ? undefined : advisorEffort
      );

      const path = saveConfig(ctx);
      ctx.ui.notify(
        `Saved Executor + Advisor configurations to ${path}`,
        "info"
      );
    },
  });

  pi.registerCommand("advisor-settings", {
    description: "Configure Advisor context and reasoning effort",
    handler: async (_args, ctx) => {
      loadConfig(ctx);
      if (!ctx.hasUI) {
        return;
      }

      const initial: AdvisorSettings = {
        autoLoopGate: advisorAutoLoopGateRef,
        blockOnBlocked: advisorBlockOnBlockedRef,
        collapseResponses: advisorCollapseResponsesRef,
        completionGate: advisorCompletionGateRef,
        contextMaxChars: contextMaxCharsRef,
        customRule: advisorCustomInvocationRef,
        effort: advisorEffortRef,
        failureGate: advisorFailureGateRef,
        failureMode: advisorFailureModeRef,
        herdrIntegration: advisorHerdrIntegrationRef,
        loopThreshold: advisorLoopThresholdRef,
        maxCallsPerSession: advisorMaxCallsPerSessionRef,
        planGate: advisorPlanGateRef,
        sessionSummary: advisorSessionSummaryRef,
        toolResultMaxBytes: advisorToolResultMaxBytesRef,
        toolResultMaxLines: advisorToolResultMaxLinesRef,
      };
      const settings = await ctx.ui.custom<AdvisorSettings | undefined>(
        (tui, theme, _keybindings, done) =>
          new AdvisorSettingsSelector({
            effortLevels: EFFORT_LEVELS,
            initial,
            onCancel: () => done(undefined),
            onSave: done,
            presets: CONTEXT_PRESETS,
            theme,
            tui,
          })
      );
      if (!settings) {
        return;
      }

      setAdvisorEffortRef(
        settings.effort === "Default (Model Default)"
          ? undefined
          : settings.effort
      );
      setContextMaxCharsRef(settings.contextMaxChars);
      setAdvisorPlanGateRef(settings.planGate);
      setAdvisorFailureGateRef(settings.failureGate);
      setAdvisorCompletionGateRef(settings.completionGate);
      setAdvisorCollapseResponsesRef(settings.collapseResponses);
      setAdvisorCustomInvocationRef(settings.customRule);
      setAdvisorBlockOnBlockedRef(settings.blockOnBlocked ?? true);
      setAdvisorAutoLoopGateRef(settings.autoLoopGate ?? true);
      setAdvisorLoopThresholdRef(settings.loopThreshold ?? 3);
      setAdvisorMaxCallsPerSessionRef(settings.maxCallsPerSession);
      setAdvisorSessionSummaryRef(settings.sessionSummary ?? true);
      setAdvisorFailureModeRef(settings.failureMode ?? "block-session");
      setAdvisorHerdrIntegrationRef(settings.herdrIntegration ?? true);
      setAdvisorToolResultMaxLinesRef(settings.toolResultMaxLines ?? 2000);
      setAdvisorToolResultMaxBytesRef(settings.toolResultMaxBytes ?? 50 * 1024);
      const path = saveConfig(ctx);
      ctx.ui.notify(`Saved Advisor settings to ${path}`, "info");
    },
  });

  pi.registerCommand("advisor-off", {
    description: "Disable on-demand Advisor calls; keep the current model",
    handler: async (_args, ctx) => {
      pi.setActiveTools(
        pi.getActiveTools().filter((name) => name !== "ask_advisor")
      );
      if (ctx.hasUI) {
        ctx.ui.notify(
          "Advisor flow disabled. Current model unchanged.",
          "info"
        );
      }
    },
  });
};
