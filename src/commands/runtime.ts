import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { getAdvisorSettings } from "../config/state.ts";
import { herdrAdvisorActivity, notifyHerdrAdvisorFailure } from "../herdr.ts";
import { t } from "../i18n.ts";
import type { AdvisorSessionState } from "../session-state.ts";
import { consultAdvisor } from "../tools/consultation.ts";
import {
  sameModelAdvisorDisabled,
  sameModelAdvisorNotice,
} from "../tools/model-access.ts";
import { ScoutStatusManager } from "../tools/scout-status.ts";
import { sessionStateFor } from "../tools/session.ts";
import { uiAction } from "../ui-guard.ts";
import type {
  CommandDependencies,
  CommandRuntime as CommandRuntimeContract,
  ManualAdvisorProgressState,
  ManualConsult,
} from "./types.ts";

export const notify = (
  ctx: ExtensionContext,
  message: string,
  level: "error" | "info" | "warning"
) => {
  uiAction(ctx, (ui) => ui.notify(message, level));
};

const reportManualBudgetExhausted = (ctx: ExtensionContext) => {
  notify(
    ctx,
    t(
      "notify.budgetExhausted.message",
      "Advisor call budget exhausted for this session."
    ),
    "warning"
  );
  notifyHerdrAdvisorFailure(
    "Advisor budget exhausted",
    "Advisor call budget exhausted for this session."
  );
};

const requestManualRender = (ctx: ExtensionContext) => {
  uiAction(ctx, (ui) => ui.setStatus("advisor-manual", undefined));
};

class CommandRuntime implements CommandRuntimeContract {
  readonly advisorSessionState: AdvisorSessionState;
  readonly herdrActivity: NonNullable<CommandDependencies["herdrActivity"]>;
  readonly manualConsultations = new Map<AbortController, symbol>();
  readonly manualProgress = new Map<string, ManualAdvisorProgressState>();
  readonly manualProgressTimers = new Map<
    AbortController,
    ReturnType<typeof setInterval>
  >();
  readonly pi: ExtensionAPI;
  readonly reportManualBudgetExhausted = reportManualBudgetExhausted;
  readonly requestAdvisor: ManualConsult;
  readonly requestManualRender = requestManualRender;
  readonly scoutStatus: ScoutStatusManager;
  manualProgressSequence = 0;
  suppressModelSelectionSync = false;
  toolAvailabilityRevision = 0;
  private lastSameModelDisabled: boolean | undefined;

  constructor(pi: ExtensionAPI, dependencies: CommandDependencies = {}) {
    this.pi = pi;
    this.advisorSessionState = dependencies.sessionState ?? sessionStateFor(pi);
    this.herdrActivity = dependencies.herdrActivity ?? herdrAdvisorActivity;
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
          undefined,
          undefined,
          (adviceId, payload, replacesAdviceId) =>
            this.advisorSessionState.captureFollowUp(
              adviceId,
              payload,
              replacesAdviceId
            )
        ));
  }

  flowEnabled() {
    return this.pi.getActiveTools().includes("ask_advisor");
  }

  noteAdvisorToolsStateChange() {
    this.toolAvailabilityRevision += 1;
  }

  resetSameModelNotice() {
    this.lastSameModelDisabled = undefined;
  }

  updateSameModelNotice(
    ctx: ExtensionContext,
    model: { id: string; provider: string } | undefined = ctx.model
  ) {
    if (!this.flowEnabled()) {
      return;
    }

    const disabled = sameModelAdvisorDisabled(ctx, model);

    if (disabled && this.lastSameModelDisabled !== true) {
      notify(ctx, sameModelAdvisorNotice, "info");
    } else if (!disabled && this.lastSameModelDisabled === true) {
      notify(
        ctx,
        t(
          "notify.sameModelReenabled.message",
          "Advisor re-enabled: executor and advisor models differ."
        ),
        "info"
      );
    }

    this.lastSameModelDisabled = disabled;
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
    uiAction(ctx, (ui) =>
      ui.setStatus(
        "advisor-usage",
        getAdvisorSettings().showUsageFooter
          ? this.advisorSessionState.usageStatus()
          : undefined
      )
    );
  }
}

export const createCommandRuntime = (
  pi: ExtensionAPI,
  dependencies: CommandDependencies = {}
) => new CommandRuntime(pi, dependencies);
