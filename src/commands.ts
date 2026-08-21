import {
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import {
  advisorEffortRef,
  advisorMaxCallsPerSessionRef,
  advisorRef,
  alwaysOnRef,
  contextMaxCharsRef,
  executorEffortRef,
  executorRef,
  getAdvisorSettings,
  isSimpleMode,
  loadConfig,
  parseArgs,
  saveConfig,
  saveGlobalOutcomeLogging,
  setAdvisorAutoLoopGateRef,
  setAdvisorBlockOnBlockedRef,
  setAdvisorCollapseResponsesRef,
  setAdvisorCompletionGateRef,
  setAdvisorCustomInvocationRef,
  setAdvisorEffortRef,
  setAdvisorFailureGateRef,
  setAdvisorFailureModeRef,
  setAdvisorGitContextMaxCharsRef,
  setAdvisorGitContextRef,
  setAdvisorHerdrIntegrationRef,
  setAdvisorLoopThresholdRef,
  setAdvisorMaxCallsPerSessionRef,
  setAdvisorOutcomeLoggingRef,
  setAdvisorPlanGateRef,
  setAdvisorRedactSecretsRef,
  setAdvisorRef,
  setAdvisorScoutEnabledRef,
  setAdvisorSessionSummaryRef,
  setAdvisorToolPoliciesRef,
  setAdvisorToolResultMaxBytesRef,
  setAdvisorToolResultMaxLinesRef,
  setAdvisorTrackedFileContentRef,
  setAdvisorUntrackedContentRef,
  setAlwaysOnRef,
  setContextMaxCharsRef,
  setExecutorEffortRef,
  setExecutorRef,
  setSimpleModeRef,
  splitRef,
} from "./config.js";
import { herdrAdvisorActivity, notifyHerdrAdvisorFailure } from "./herdr.js";
import type { ScoutLifecycleEvent } from "./scout.js";
import type { AdvisorSessionState } from "./session-state.js";
import type { BenchmarkTelemetry } from "./telemetry.js";
import {
  adviceForDisplay,
  appendScoutLifecycleEntry,
  consultAdvisor,
  advisorSessionState as defaultAdvisorSessionState,
  hasSoundVerdict,
  renderAdvisorCallBox,
  renderAdvisorResponseHeader,
  resolveAdvisorRequest,
  ScoutStatusManager,
} from "./tools.js";
import {
  type AdvisorSettings,
  AdvisorSettingsSelector,
  type ContextPreset,
  SearchableModelSelector,
} from "./ui.js";

const DEFAULT_EFFORT_LEVEL = "Default (Model Default)";
const SELECTED_PREFIX = "✓ ";
const EFFORT_LEVELS = [
  DEFAULT_EFFORT_LEVEL,
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const effortChoices = (configured: string | undefined): string[] => {
  const current = configured ?? DEFAULT_EFFORT_LEVEL;
  return [
    `${SELECTED_PREFIX}${current}`,
    ...EFFORT_LEVELS.filter((level) => level !== current),
  ];
};

const selectedEffort = (choice: string): string | undefined => {
  const effort = choice.startsWith(SELECTED_PREFIX)
    ? choice.slice(SELECTED_PREFIX.length)
    : choice;
  return effort === DEFAULT_EFFORT_LEVEL ? undefined : effort;
};

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
  signal?: AbortSignal,
  onChunk?: (thinking: string, text: string) => void,
  onScout?: (event: ScoutLifecycleEvent) => void
) => Promise<{
  markdown: string;
  thinkingText: string;
  draftBytes?: number;
  preferenceBytes?: number;
}>;
type ThinkingLevel = Parameters<ExtensionAPI["setThinkingLevel"]>[0];

const notify = (
  ctx: ExtensionContext,
  message: string,
  level: "error" | "info" | "warning"
) => {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
  }
};

const findConfiguredModel = (ctx: ExtensionContext, ref: string) => {
  const [provider, modelId] = splitRef(ref);
  return ctx.modelRegistry.find(provider, modelId);
};

export const registerCommands = (
  pi: ExtensionAPI,
  dependencies: {
    consult?: ManualConsult;
    sessionState?: AdvisorSessionState;
    statusManager?: ScoutStatusManager;
    telemetry?: BenchmarkTelemetry;
  } = {}
) => {
  const advisorSessionState =
    dependencies.sessionState ?? defaultAdvisorSessionState;
  const scoutStatus = dependencies.statusManager ?? new ScoutStatusManager();
  const flowEnabled = () => pi.getActiveTools().includes("ask_advisor");
  const requestAdvisor =
    dependencies.consult ??
    ((ctx, question, signal, onChunk, onScout) =>
      consultAdvisor(
        ctx,
        question,
        signal,
        onChunk,
        "manual",
        undefined,
        undefined,
        undefined,
        undefined,
        onScout,
        undefined,
        dependencies.telemetry
      ));
  const manualConsultations = new Map<AbortController, symbol>();
  const setManualStatus = (
    ctx: ExtensionContext,
    controller: AbortController,
    token: symbol,
    status: string | undefined
  ) => {
    if (
      ctx.hasUI &&
      manualConsultations.get(controller) === token &&
      !controller.signal.aborted
    ) {
      ctx.ui.setStatus("advisor-manual", status);
    }
  };

  const startManualConsultation = (
    ctx: ExtensionContext,
    question: string | undefined,
    controller: AbortController,
    scoutStatusToken: symbol
  ) => {
    herdrAdvisorActivity.start();
    setManualStatus(ctx, controller, scoutStatusToken, "Advisor preparing…");
    let scoutDetails: Parameters<typeof appendScoutLifecycleEntry>[2];
    return requestAdvisor(
      ctx,
      question,
      controller.signal,
      (thinking, text) => {
        if (controller.signal.aborted) {
          return;
        }
        let status = "Advisor working…";
        if (thinking.trim()) {
          status = "Advisor thinking…";
        }
        if (text.trim()) {
          status = "Advisor responding…";
        }
        setManualStatus(ctx, controller, scoutStatusToken, status);
      },
      (event) => {
        if (!controller.signal.aborted) {
          scoutStatus.update(ctx, scoutStatusToken, event);
          if (event.type === "call" || event.type === "chunk") {
            setManualStatus(
              ctx,
              controller,
              scoutStatusToken,
              "Advisor Scout curating…"
            );
          } else if (event.type === "success" || event.type === "fallback") {
            setManualStatus(
              ctx,
              controller,
              scoutStatusToken,
              "Advisor working…"
            );
          }
          scoutDetails = appendScoutLifecycleEntry(pi, event, scoutDetails);
        }
      }
    )
      .then(({ markdown }) => {
        if (controller.signal.aborted) {
          return;
        }
        advisorSessionState.recordInvocation({
          executionEffect: "continued",
          kind: "markdown",
          model: advisorRef,
          trigger: "manual",
        });
        pi.sendMessage(
          {
            content: `Manual Advisor consultation${question ? ` (${question})` : ""}:\n\n${markdown}`,
            customType: "advisor-manual-result",
            details: { advisor: advisorRef, question, text: markdown },
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
        const message = error instanceof Error ? error.message : String(error);
        advisorSessionState.recordInvocation({
          executionEffect: "continued",
          failure: "provider-error",
          kind: "markdown",
          model: advisorRef,
          trigger: "manual",
        });
        pi.sendMessage(
          {
            content: `Manual Advisor consultation failed: ${message}`,
            customType: "advisor-manual-result",
            details: {
              advisor: advisorRef,
              text: `**Advisor consultation failed:** ${message}`,
            },
            display: true,
          },
          { deliverAs: "steer", triggerTurn: true }
        );
        notify(ctx, `Advisor consultation failed: ${message}`, "error");
        notifyHerdrAdvisorFailure("Advisor consultation failed", message);
      })
      .finally(() => {
        if (
          ctx.hasUI &&
          manualConsultations.get(controller) === scoutStatusToken
        ) {
          ctx.ui.setStatus("advisor-manual", undefined);
        }
        scoutStatus.release(ctx, scoutStatusToken);
        manualConsultations.delete(controller);
        herdrAdvisorActivity.finish();
      });
  };

  /** Resolves both models and their auth, or reports why activation cannot proceed. */
  const resolveActivationModels = async (ctx: ExtensionContext) => {
    const executor = findConfiguredModel(ctx, executorRef);
    if (!executor) {
      return { error: `Executor model not found: ${executorRef}` };
    }
    const advisor = findConfiguredModel(ctx, advisorRef);
    if (!advisor) {
      return { error: `Advisor model not found: ${advisorRef}` };
    }
    const advisorAuth = await ctx.modelRegistry.getApiKeyAndHeaders(advisor);
    if (!(advisorAuth.ok && advisorAuth.apiKey)) {
      return { error: `No API key for Advisor ${advisorRef}` };
    }
    if (!(await pi.setModel(executor))) {
      return { error: `No API key for Executor ${executorRef}` };
    }
    return {};
  };

  const loadCommandConfig = (ctx: ExtensionContext) => {
    try {
      loadConfig(ctx);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify(
        ctx,
        `Advisor command could not load configuration: ${message} Fix advisor.json and retry.`,
        "error"
      );
      return false;
    }
  };

  const activateAdvisor = async (
    args: string,
    ctx: ExtensionContext,
    announce = true
  ) => {
    if (!loadCommandConfig(ctx)) {
      return;
    }
    const previous = {
      advisor: advisorRef,
      contextMaxChars: contextMaxCharsRef,
      executor: executorRef,
    };
    const restoreRefs = () => {
      setAdvisorRef(previous.advisor);
      setContextMaxCharsRef(previous.contextMaxChars);
      setExecutorRef(previous.executor);
    };
    const argumentError = parseArgs(args);
    if (argumentError) {
      restoreRefs();
      notify(ctx, argumentError, "error");
      return;
    }
    const { error } = await resolveActivationModels(ctx);
    if (error) {
      restoreRefs();
      notify(ctx, error, "error");
      return;
    }
    // parseArgs only mutates in-memory refs, and every later loadConfig resets
    // them from disk. Persist supplied arguments once they are known to resolve,
    // so an unusable model reference is never written to the configuration.
    if (args.trim()) {
      saveConfig(ctx);
    }
    if (executorEffortRef) {
      pi.setThinkingLevel(executorEffortRef as ThinkingLevel);
    }
    if (!flowEnabled()) {
      pi.setActiveTools([
        ...pi.getActiveTools(),
        "ask_advisor",
        "record_advisor_outcome",
      ]);
    }
    if (announce) {
      notify(
        ctx,
        `Advisor flow ready — Executor: ${executorRef} (thinking: ${executorEffortRef || "default"}) · Advisor: ${advisorRef} (thinking: ${advisorEffortRef || "default"})`,
        "info"
      );
    }
  };

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
      const advice =
        details?.text ??
        (typeof message.content === "string"
          ? message.content
          : "(Advisor returned no advice.)");
      // Manual consultations must render exactly like an Executor ask_advisor call.
      box.addChild(
        new Text(
          renderAdvisorResponseHeader(hasSoundVerdict(advice), theme),
          0,
          0
        )
      );
      if (details?.advisor) {
        box.addChild(new Text(theme.fg("dim", `  ${details.advisor}`), 0, 0));
      }
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

  pi.on("session_start", async (_event, ctx) => {
    // A malformed advisor.json or a provider auth failure must not reject a
    // lifecycle handler and break session startup.
    try {
      loadConfig(ctx);
      if (alwaysOnRef) {
        await activateAdvisor("", ctx, false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify(ctx, `Advisor activation failed: ${message}`, "error");
    }
  });

  pi.on("model_select", (event, ctx) => {
    // Only an explicit user selection redefines the Executor. "restore" replays a
    // stored session model and would otherwise overwrite saved configuration.
    if (event.source !== "set" || !flowEnabled()) {
      return;
    }
    const selected = `${event.model.provider}/${event.model.id}`;
    if (selected === executorRef) {
      return;
    }
    setExecutorRef(selected);
    saveConfig(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("advisor-manual", undefined);
    }
    for (const [controller, token] of manualConsultations) {
      controller.abort();
      scoutStatus.release(ctx, token);
    }
    scoutStatus.clear(ctx);
    manualConsultations.clear();
    herdrAdvisorActivity.clear();
  });

  pi.registerCommand("advisor-manual", {
    description:
      "Consult the Advisor in parallel; accepts an optional focused question and fans its response out to the Executor",
    handler: (args, ctx) => {
      if (!loadCommandConfig(ctx)) {
        return Promise.resolve();
      }
      if (
        !(
          isSimpleMode() ||
          advisorSessionState.canConsult(advisorMaxCallsPerSessionRef)
        )
      ) {
        const message = "Advisor call budget exhausted for this session.";
        notify(ctx, message, "warning");
        notifyHerdrAdvisorFailure("Advisor budget exhausted", message);
        return Promise.resolve();
      }
      if (!isSimpleMode()) {
        advisorSessionState.consumeCall();
      }
      const question = resolveAdvisorRequest(args);
      // A single visible progress surface avoids competing consultations overwriting
      // each other's streamed state. A newer manual request replaces the previous one.
      for (const [pending, token] of manualConsultations) {
        pending.abort();
        scoutStatus.release(ctx, token);
      }
      manualConsultations.clear();
      const controller = new AbortController();
      const scoutStatusToken = Symbol("manual-scout");
      scoutStatus.register(scoutStatusToken);
      manualConsultations.set(controller, scoutStatusToken);
      pi.appendEntry?.("advisor-manual-call", { question });
      startManualConsultation(ctx, question, controller, scoutStatusToken);
      return Promise.resolve();
    },
  });

  pi.registerCommand("advisor", {
    description:
      "Enable the Executor/Advisor flow and switch to the configured Executor model; accepts contextMaxChars=N",
    handler: (args, ctx) => activateAdvisor(args, ctx),
  });

  pi.registerCommand("advisor-models", {
    description:
      "Select and persist the Executor and Advisor models with reasoning levels",
    handler: async (_args, ctx) => {
      if (!(loadCommandConfig(ctx) && ctx.hasUI)) {
        return;
      }
      const refs = ctx.modelRegistry
        .getAvailable()
        .map((m) => `${m.provider}/${m.id}`);

      const executor = await ctx.ui.custom<string | undefined>(
        (tui, theme, keybindings, done) =>
          new SearchableModelSelector({
            allOptions: refs,
            currentOption: executorRef,
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
        effortChoices(executorEffortRef)
      );
      if (!executorEffort) {
        return;
      }

      const advisor = await ctx.ui.custom<string | undefined>(
        (tui, theme, keybindings, done) =>
          new SearchableModelSelector({
            allOptions: refs,
            currentOption: advisorRef,
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
        effortChoices(advisorEffortRef)
      );
      if (!advisorEffort) {
        return;
      }

      setExecutorRef(executor);
      setAdvisorRef(advisor);
      setExecutorEffortRef(selectedEffort(executorEffort));
      setAdvisorEffortRef(selectedEffort(advisorEffort));

      const path = saveConfig(ctx);
      ctx.ui.notify(
        `Saved Executor + Advisor configurations to ${path}`,
        "info"
      );
    },
  });

  pi.registerCommand("advisor-settings", {
    description: "Configure Advisor context and reasoning effort",
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one settings form maps every persisted control.
    handler: async (_args, ctx) => {
      if (!(loadCommandConfig(ctx) && ctx.hasUI)) {
        return;
      }

      const initial: AdvisorSettings = getAdvisorSettings();
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
      setAdvisorSessionSummaryRef(settings.sessionSummary ?? false);
      setAdvisorScoutEnabledRef(settings.scoutEnabled ?? false);
      setSimpleModeRef(settings.simpleMode ?? false);
      setAlwaysOnRef(settings.alwaysOn ?? false);
      setAdvisorFailureModeRef(settings.failureMode ?? "block-session");
      setAdvisorHerdrIntegrationRef(settings.herdrIntegration ?? true);
      setAdvisorToolResultMaxLinesRef(settings.toolResultMaxLines ?? 2000);
      setAdvisorToolResultMaxBytesRef(settings.toolResultMaxBytes ?? 50 * 1024);
      setAdvisorRedactSecretsRef(settings.redactSecrets ?? false);
      setAdvisorGitContextRef(settings.gitContext ?? "summary");
      setAdvisorGitContextMaxCharsRef(settings.gitContextMaxChars ?? 20_000);
      setAdvisorToolPoliciesRef(settings.toolPolicies ?? {});
      setAdvisorTrackedFileContentRef(settings.trackedFileContent ?? false);
      setAdvisorUntrackedContentRef(settings.untrackedContent ?? false);
      setAdvisorOutcomeLoggingRef(settings.outcomeLogging ?? false);
      const path = saveConfig(ctx);
      const globalPath = saveGlobalOutcomeLogging(
        settings.outcomeLogging ?? false
      );
      ctx.ui.notify(
        `Saved Advisor settings to ${path}; outcome logging globally to ${globalPath}`,
        "info"
      );
    },
  });

  pi.registerCommand("advisor-off", {
    description: "Disable on-demand Advisor calls; keep the current model",
    handler: (_args, ctx) => {
      pi.setActiveTools(
        pi
          .getActiveTools()
          .filter(
            (name) =>
              name !== "ask_advisor" && name !== "record_advisor_outcome"
          )
      );
      // Leaving alwaysOn set would silently reactivate the flow next session.
      const wasAlwaysOn = alwaysOnRef;
      if (wasAlwaysOn) {
        setAlwaysOnRef(false);
        saveConfig(ctx);
      }
      notify(
        ctx,
        `Advisor flow disabled. Current model unchanged.${wasAlwaysOn ? " Always on turned off." : ""}`,
        "info"
      );
      return Promise.resolve();
    },
  });
};
