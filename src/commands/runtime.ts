import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAdvisorSettings } from "../config/state.js";
import { notifyHerdrAdvisorFailure } from "../herdr.js";
import type { AdvisorSessionState } from "../session-state.js";
import { consultAdvisor } from "../tools/consultation.js";
import { ScoutStatusManager } from "../tools/scout-status.js";
import { advisorSessionState as defaultAdvisorSessionState } from "../tools/session.js";
import type {
  CommandDependencies,
  CommandRuntime as CommandRuntimeContract,
  ManualAdvisorProgressState,
  ManualConsult,
} from "./types.js";

export const notify = (
  ctx: ExtensionContext,
  message: string,
  level: "error" | "info" | "warning"
) => {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
  }
};

export class CommandRuntime implements CommandRuntimeContract {
  readonly advisorSessionState: AdvisorSessionState;
  readonly manualConsultations = new Map<AbortController, symbol>();
  readonly manualProgress = new Map<string, ManualAdvisorProgressState>();
  readonly manualProgressTimers = new Map<
    AbortController,
    ReturnType<typeof setInterval>
  >();
  readonly pi: ExtensionAPI;
  readonly requestAdvisor: ManualConsult;
  readonly scoutStatus: ScoutStatusManager;
  manualProgressSequence = 0;
  pendingExecutorModelRef: string | undefined;
  suppressModelSelectionSync = false;

  constructor(pi: ExtensionAPI, dependencies: CommandDependencies = {}) {
    this.pi = pi;
    this.advisorSessionState =
      dependencies.sessionState ?? defaultAdvisorSessionState;
    this.scoutStatus =
      dependencies.statusManager ?? new ScoutStatusManager(false);
    this.requestAdvisor =
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
  }

  flowEnabled() {
    return this.pi.getActiveTools().includes("ask_advisor");
  }

  nextManualProgressId() {
    this.manualProgressSequence += 1;
    return `manual-${this.manualProgressSequence}`;
  }

  async setExecutorModel(
    model: Parameters<ExtensionAPI["setModel"]>[0]
  ): Promise<boolean> {
    this.suppressModelSelectionSync = true;
    try {
      return await this.pi.setModel(model);
    } finally {
      this.suppressModelSelectionSync = false;
    }
  }

  updateAdvisorUsageStatus(ctx: ExtensionContext) {
    if (ctx.hasUI) {
      ctx.ui.setStatus(
        "advisor-usage",
        getAdvisorSettings().showUsageFooter
          ? this.advisorSessionState.usageStatus()
          : undefined
      );
    }
  }

  reportManualBudgetExhausted(ctx: ExtensionContext) {
    const message = "Advisor call budget exhausted for this session.";
    notify(ctx, message, "warning");
    notifyHerdrAdvisorFailure("Advisor budget exhausted", message);
  }

  requestManualRender(ctx: ExtensionContext) {
    if (ctx.hasUI) {
      ctx.ui.setStatus("advisor-manual", undefined);
    }
  }
}

export const createCommandRuntime = (
  pi: ExtensionAPI,
  dependencies: CommandDependencies = {}
) => new CommandRuntime(pi, dependencies);
