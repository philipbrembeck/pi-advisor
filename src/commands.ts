import {
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Box, type Component, Markdown, Text } from "@earendil-works/pi-tui";
import {
  advisorEffortRef,
  advisorRef,
  alwaysOnRef,
  contextMaxCharsRef,
  executorEffortRef,
  executorRef,
  getAdvisorMaxCallsPerSession,
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
  setShowUsageDetailsRef,
  setShowUsageFooterRef,
  setSimpleModeRef,
  splitRef,
} from "./config.js";
import type { GitContextLevel } from "./git.js";
import { herdrAdvisorActivity, notifyHerdrAdvisorFailure } from "./herdr.js";
import type { ScoutLifecycleEvent } from "./scout.js";
import type { AdvisorSessionState } from "./session-state.js";
import {
  adviceForDisplay,
  appendScoutLifecycleEntry,
  consultAdvisor,
  advisorSessionState as defaultAdvisorSessionState,
  hasSoundVerdict,
  renderAdvisorCallBox,
  renderAdvisorResponseHeader,
  renderScoutDetails,
  resolveAdvisorRequest,
  ScoutStatusManager,
  type ScoutToolDetails,
  SPINNER_FRAMES,
} from "./tools.js";
import {
  type AdvisorSettings,
  AdvisorSettingsSelector,
  type ContextPreset,
  ManualAdvisorDialog,
  type ManualAdvisorRequest,
  SearchableModelSelector,
} from "./ui.js";
import {
  advisorUsageCost,
  formatAdvisorUsage,
  snapshotAdvisorUsage,
} from "./usage.js";

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
const ARGUMENT_WHITESPACE = /\s+/;
const hasExecutorOverride = (args: string) =>
  args
    .trim()
    .split(ARGUMENT_WHITESPACE)
    .some((token) => {
      const [key, value] = token.split("=");
      return key === "executor" && Boolean(value);
    });

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
  onScout?: (event: ScoutLifecycleEvent) => void,
  gitContext?: GitContextLevel
) => Promise<{
  markdown: string;
  thinkingText: string;
  draftBytes?: number;
  preferenceBytes?: number;
  usage?: unknown;
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

type ManualAdvisorProgressPhase =
  | "preparing"
  | "active"
  | "complete"
  | "cancelled"
  | "error";
interface ManualAdvisorProgressState {
  phase: ManualAdvisorProgressPhase;
  scout?: ScoutToolDetails;
  text?: string;
  thinking?: string;
}

class ManualAdvisorProgressComponent implements Component {
  private readonly question: string | undefined;
  private readonly state: ManualAdvisorProgressState;
  private readonly expanded: boolean;
  private readonly theme: Theme;

  constructor(
    question: string | undefined,
    state: ManualAdvisorProgressState,
    expanded: boolean,
    theme: Theme
  ) {
    this.question = question;
    this.state = state;
    this.expanded = expanded;
    this.theme = theme;
  }

  render(width: number): string[] {
    const box = renderAdvisorCallBox(this.question, this.theme);
    if (this.state.phase === "complete" || this.state.phase === "cancelled") {
      return box.render(width);
    }

    const { scout } = this.state;
    const scoutActive =
      scout?.status === "calling" || scout?.status === "streaming";
    if (scoutActive) {
      renderScoutDetails(box, scout, this.expanded, this.theme);
      return box.render(width);
    }
    if (scout?.status === "cancelled") {
      return box.render(width);
    }
    if (this.state.phase === "error") {
      box.addChild(
        new Text(
          this.theme.fg("error", this.theme.bold("◆ ADVISOR · FAILED")),
          0,
          0
        )
      );
      return box.render(width);
    }

    const frame =
      SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
    let status = "Working…";
    if (this.state.phase === "preparing") {
      status = "Preparing…";
    } else if (this.state.text?.trim()) {
      status = "Responding…";
    }
    box.addChild(
      new Text(
        `${this.theme.fg("warning", this.theme.bold(`◆ ADVISOR ${frame}`))} ${this.theme.fg("dim", `· ${status}`)}`,
        0,
        0
      )
    );
    if (this.state.thinking) {
      box.addChild(
        new Text(
          this.theme.fg(
            "thinkingText",
            `  💭 ${this.state.thinking.replace(/\n/g, " ").slice(-200)}`
          ),
          0,
          0
        )
      );
    }
    if (this.state.text) {
      box.addChild(
        new Markdown(
          adviceForDisplay(this.state.text, this.expanded),
          0,
          0,
          getMarkdownTheme()
        )
      );
    }
    return box.render(width);
  }

  invalidate(): void {
    // The live progress state is read during each render.
  }
}

const findConfiguredModel = (ctx: ExtensionContext, ref: string) => {
  const [provider, modelId] = splitRef(ref);
  return ctx.modelRegistry.find(provider, modelId);
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one settings form maps every persisted control.
const applyAdvisorSettings = (settings: AdvisorSettings) => {
  setAdvisorEffortRef(
    settings.effort === "Default (Model Default)" ? undefined : settings.effort
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
  setShowUsageDetailsRef(settings.showUsageDetails ?? true);
  setShowUsageFooterRef(settings.showUsageFooter ?? false);
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
};

const saveAdvisorSettings = (
  ctx: ExtensionContext,
  settings: AdvisorSettings
) => {
  applyAdvisorSettings(settings);
  saveConfig(ctx);
  saveGlobalOutcomeLogging(settings.outcomeLogging ?? false);
};

export const registerCommands = (
  pi: ExtensionAPI,
  dependencies: {
    consult?: ManualConsult;
    sessionState?: AdvisorSessionState;
    statusManager?: ScoutStatusManager;
  } = {}
) => {
  const advisorSessionState =
    dependencies.sessionState ?? defaultAdvisorSessionState;
  const scoutStatus =
    dependencies.statusManager ?? new ScoutStatusManager(false);
  const flowEnabled = () => pi.getActiveTools().includes("ask_advisor");
  const requestAdvisor =
    dependencies.consult ??
    ((ctx, question, signal, onChunk, onScout, gitContext) =>
      consultAdvisor(
        ctx,
        question,
        signal,
        onChunk,
        "manual",
        gitContext,
        undefined,
        undefined,
        undefined,
        onScout,
        undefined
      ));
  // Pi's model_select event reports both built-in `/model` changes and direct
  // pi.setModel() calls. Keep an inactive user selection transiently so
  // `/advisor` can adopt it without treating every normal model change as a
  // global default. The suppression flag covers this extension's own restore.
  let pendingExecutorModelRef: string | undefined;
  let suppressModelSelectionSync = false;
  const setExecutorModel = async (
    model: Parameters<ExtensionAPI["setModel"]>[0]
  ) => {
    suppressModelSelectionSync = true;
    try {
      return await pi.setModel(model);
    } finally {
      suppressModelSelectionSync = false;
    }
  };
  const manualConsultations = new Map<AbortController, symbol>();
  const manualProgressTimers = new Map<
    AbortController,
    ReturnType<typeof setInterval>
  >();
  const manualProgress = new Map<string, ManualAdvisorProgressState>();
  let manualProgressSequence = 0;
  const updateAdvisorUsageStatus = (ctx: ExtensionContext) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus(
        "advisor-usage",
        getAdvisorSettings().showUsageFooter
          ? advisorSessionState.usageStatus()
          : undefined
      );
    }
  };
  const reportManualBudgetExhausted = (ctx: ExtensionContext) => {
    const message = "Advisor call budget exhausted for this session.";
    notify(ctx, message, "warning");
    notifyHerdrAdvisorFailure("Advisor budget exhausted", message);
  };

  // A status update with an undefined value is an invisible render pulse. The
  // transcript owns manual progress now, so no consultation text is kept in the
  // footer while this pulse still drives the live spinner.
  const requestManualRender = (ctx: ExtensionContext) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("advisor-manual", undefined);
    }
  };

  const startManualConsultation = (
    ctx: ExtensionContext,
    question: string | undefined,
    controller: AbortController,
    scoutStatusToken: symbol,
    progress: ManualAdvisorProgressState,
    gitContext?: GitContextLevel
  ) => {
    herdrAdvisorActivity.start();
    progress.phase = "preparing";
    requestManualRender(ctx);
    if (ctx.hasUI) {
      const timer = setInterval(() => {
        if (
          controller.signal.aborted ||
          manualConsultations.get(controller) !== scoutStatusToken
        ) {
          clearInterval(timer);
          return;
        }
        requestManualRender(ctx);
      }, 80);
      manualProgressTimers.set(controller, timer);
    }
    let scoutDetails: Parameters<typeof appendScoutLifecycleEntry>[2];
    return requestAdvisor(
      ctx,
      question,
      controller.signal,
      (thinking, text) => {
        if (controller.signal.aborted) {
          return;
        }
        progress.phase = "active";
        progress.thinking = thinking;
        progress.text = text;
        requestManualRender(ctx);
      },
      (event) => {
        if (!controller.signal.aborted) {
          scoutStatus.update(ctx, scoutStatusToken, event);
          scoutDetails = appendScoutLifecycleEntry(pi, event, scoutDetails);
          progress.scout = scoutDetails;
          progress.phase = "active";
          requestManualRender(ctx);
        }
      },
      gitContext
    )
      .then(({ markdown, usage }) => {
        if (controller.signal.aborted) {
          return;
        }
        progress.phase = "complete";
        advisorSessionState.recordInvocation({
          cost: advisorUsageCost(usage),
          executionEffect: "continued",
          kind: "markdown",
          model: advisorRef,
          trigger: "manual",
          usage,
        });
        updateAdvisorUsageStatus(ctx);
        const normalizedUsage = snapshotAdvisorUsage(usage);
        pi.sendMessage(
          {
            content: `Manual Advisor consultation${question ? ` (${question})` : ""}:\n\n${markdown}`,
            customType: "advisor-manual-result",
            details: {
              advisor: advisorRef,
              question,
              text: markdown,
              ...(normalizedUsage ? { usage: normalizedUsage } : {}),
            },
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
        progress.phase = "error";
        const message = error instanceof Error ? error.message : String(error);
        advisorSessionState.recordInvocation({
          executionEffect: "continued",
          failure: "provider-error",
          kind: "markdown",
          model: advisorRef,
          trigger: "manual",
        });
        updateAdvisorUsageStatus(ctx);
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
        if (controller.signal.aborted) {
          progress.phase = "cancelled";
        }
        const timer = manualProgressTimers.get(controller);
        if (timer) {
          clearInterval(timer);
          manualProgressTimers.delete(controller);
        }
        requestManualRender(ctx);
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
    if (!(await setExecutorModel(executor))) {
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
    const executorOverride = hasExecutorOverride(args);
    const argumentError = parseArgs(args);
    if (argumentError) {
      restoreRefs();
      notify(ctx, argumentError, "error");
      return;
    }
    const pendingExecutor = executorOverride
      ? undefined
      : pendingExecutorModelRef;
    setExecutorRef(pendingExecutor ?? executorRef);
    const { error } = await resolveActivationModels(ctx);
    if (error) {
      restoreRefs();
      notify(ctx, error, "error");
      return;
    }
    // parseArgs and an inactive `/model` selection only mutate in-memory refs,
    // and every later loadConfig resets them from disk. Persist supplied
    // arguments or the pending selection once they are known to resolve, so an
    // unusable model reference is never written to the configuration.
    if (args.trim() || pendingExecutor) {
      saveConfig(ctx);
    }
    // A successful activation has committed the effective Executor. Do not let
    // an older inactive selection override an explicit activation argument on a
    // later attempt.
    pendingExecutorModelRef = undefined;
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
    (entry, { expanded }, theme) => {
      const { progressId, question } = (entry.data ?? {}) as {
        progressId?: string;
        question?: string;
      };
      const progress = progressId ? manualProgress.get(progressId) : undefined;
      return progress
        ? new ManualAdvisorProgressComponent(
            question,
            progress,
            Boolean(expanded),
            theme
          )
        : renderAdvisorCallBox(question, theme);
    }
  );

  pi.registerMessageRenderer?.(
    "advisor-manual-result",
    (message, { expanded }, theme) => {
      const details = message.details as
        | { advisor?: string; text?: string; usage?: unknown }
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
      if (getAdvisorSettings().showUsageDetails) {
        const usage = formatAdvisorUsage(details?.usage);
        if (usage) {
          box.addChild(new Text(theme.fg("dim", `  Usage: ${usage}`), 0, 0));
        }
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
    pendingExecutorModelRef = undefined;
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
    // "restore" replays a stored session model and "cycle" changes the active
    // model without an explicit `/model` choice. Neither should redefine the
    // configured Executor.
    if (event.source !== "set" || suppressModelSelectionSync) {
      return;
    }
    const selected = `${event.model.provider}/${event.model.id}`;
    if (!flowEnabled()) {
      // Defer persistence until `/advisor` succeeds. This keeps ordinary model
      // selection global defaults untouched when the flow is not enabled.
      pendingExecutorModelRef = selected;
      return;
    }
    pendingExecutorModelRef = undefined;
    if (selected === executorRef) {
      return;
    }
    setExecutorRef(selected);
    saveConfig(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("advisor-usage", undefined);
    }
    for (const [controller, token] of manualConsultations) {
      controller.abort();
      const timer = manualProgressTimers.get(controller);
      if (timer) {
        clearInterval(timer);
        manualProgressTimers.delete(controller);
      }
      scoutStatus.release(ctx, token);
    }
    scoutStatus.clear(ctx);
    manualConsultations.clear();
    manualProgressTimers.clear();
    manualProgress.clear();
    herdrAdvisorActivity.clear();
  });

  pi.registerCommand("advisor-manual", {
    description:
      "Consult the Advisor in parallel; accepts an optional focused question and fans its response out to the Executor",
    handler: async (args, ctx) => {
      if (!loadCommandConfig(ctx)) {
        return;
      }
      if (
        !(
          isSimpleMode() ||
          advisorSessionState.canConsult(getAdvisorMaxCallsPerSession())
        )
      ) {
        reportManualBudgetExhausted(ctx);
        return;
      }

      let gitContext: GitContextLevel | undefined;
      let question: string | undefined;
      if (ctx.mode === "tui") {
        const request = await ctx.ui.custom<ManualAdvisorRequest | undefined>(
          (tui, theme, keybindings, done) =>
            new ManualAdvisorDialog({
              gitContext: getAdvisorSettings().gitContext,
              initialMessage: args,
              keybindings,
              onCancel: () => done(undefined),
              onSubmit: done,
              theme,
              tui,
            }),
          {
            overlay: true,
            overlayOptions: {
              anchor: "center",
              margin: 2,
              maxHeight: "80%",
              minWidth: 56,
              width: 76,
            },
          }
        );
        if (!request) {
          return;
        }
        if (
          !(
            isSimpleMode() ||
            advisorSessionState.canConsult(getAdvisorMaxCallsPerSession())
          )
        ) {
          reportManualBudgetExhausted(ctx);
          return;
        }
        const { gitContext: selectedGitContext, message } = request;
        gitContext = selectedGitContext;
        question = resolveAdvisorRequest(message);
      } else {
        question = resolveAdvisorRequest(args);
      }

      if (!isSimpleMode()) {
        advisorSessionState.consumeCall();
      }
      // A single visible progress surface avoids competing consultations overwriting
      // each other's streamed state. A newer manual request replaces the previous one.
      for (const [pending, token] of manualConsultations) {
        pending.abort();
        scoutStatus.release(ctx, token);
      }
      manualConsultations.clear();
      const controller = new AbortController();
      const scoutStatusToken = Symbol("manual-scout");
      manualProgressSequence += 1;
      const progressId = `manual-${manualProgressSequence}`;
      const progress: ManualAdvisorProgressState = { phase: "preparing" };
      manualProgress.set(progressId, progress);
      scoutStatus.register(scoutStatusToken);
      manualConsultations.set(controller, scoutStatusToken);
      pi.appendEntry?.("advisor-manual-call", { progressId, question });
      startManualConsultation(
        ctx,
        question,
        controller,
        scoutStatusToken,
        progress,
        gitContext
      );
    },
  });

  pi.registerCommand("advisor", {
    description:
      "Enable the Executor/Advisor flow and switch to the configured or explicitly selected Executor model; accepts contextMaxChars=N",
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
      // When `/model` was used before activation, show that session choice as
      // the Executor's current option instead of making the persisted Executor
      // look like the active selection.
      const executorOption = pendingExecutorModelRef ?? executorRef;

      const executor = await ctx.ui.custom<string | undefined>(
        (tui, theme, keybindings, done) =>
          new SearchableModelSelector({
            allOptions: refs,
            currentOption: executorOption,
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
      pendingExecutorModelRef = undefined;
      ctx.ui.notify(
        `Saved Executor + Advisor configurations to ${path}`,
        "info"
      );
    },
  });

  pi.registerCommand("advisor-settings", {
    description: "Configure Advisor settings",
    handler: async (_args, ctx) => {
      if (!(loadCommandConfig(ctx) && ctx.hasUI)) {
        return;
      }

      const initial: AdvisorSettings = getAdvisorSettings();
      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) =>
          new AdvisorSettingsSelector({
            effortLevels: EFFORT_LEVELS,
            initial,
            onCancel: () => done(),
            onChange: (settings) => {
              try {
                saveAdvisorSettings(ctx, settings);
                updateAdvisorUsageStatus(ctx);
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);
                ctx.ui.notify(
                  `Could not save Advisor settings: ${message}`,
                  "error"
                );
              }
            },
            presets: CONTEXT_PRESETS,
            theme,
            tui,
          })
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
