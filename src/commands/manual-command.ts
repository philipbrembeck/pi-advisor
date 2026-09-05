import {
  getAdvisorMaxCallsPerSession,
  getAdvisorSettings,
  isSimpleMode,
} from "../config/state.js";
import type { GitContextLevel } from "../git.js";
import { resolveAdvisorRequest } from "../tools/render-common.js";
import { ManualAdvisorDialog } from "../ui/manual-dialog.js";
import type { ManualAdvisorRequest } from "../ui/types.js";
import { loadCommandConfig } from "./activation-preparation.js";
import { startManualConsultation } from "./manual-consultation.js";
import type { CommandRuntime, ManualAdvisorProgressState } from "./types.js";

export const registerManualCommand = (runtime: CommandRuntime) => {
  runtime.pi.registerCommand("advisor-manual", {
    description:
      "Consult the Advisor in parallel; accepts an optional focused question and fans its response out to the Executor",
    handler: async (args, ctx) => {
      if (!loadCommandConfig(ctx)) {
        return;
      }
      if (
        !(
          isSimpleMode() ||
          runtime.advisorSessionState.canConsult(getAdvisorMaxCallsPerSession())
        )
      ) {
        runtime.reportManualBudgetExhausted(ctx);
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
            runtime.advisorSessionState.canConsult(
              getAdvisorMaxCallsPerSession()
            )
          )
        ) {
          runtime.reportManualBudgetExhausted(ctx);
          return;
        }
        const { gitContext: selectedGitContext, message } = request;
        gitContext = selectedGitContext;
        question = resolveAdvisorRequest(message);
      } else {
        question = resolveAdvisorRequest(args);
      }

      if (!isSimpleMode()) {
        runtime.advisorSessionState.consumeCall();
      }
      // A single visible progress surface avoids competing consultations overwriting
      // each other's streamed state. A newer manual request replaces the previous one.
      for (const [pending, token] of runtime.manualConsultations) {
        pending.abort();
        runtime.scoutStatus.release(ctx, token);
      }
      runtime.manualConsultations.clear();
      const controller = new AbortController();
      const scoutStatusToken = Symbol("manual-scout");
      const progressId = runtime.nextManualProgressId();
      const progress: ManualAdvisorProgressState = { phase: "preparing" };
      runtime.manualProgress.set(progressId, progress);
      runtime.scoutStatus.register(scoutStatusToken);
      runtime.manualConsultations.set(controller, scoutStatusToken);
      runtime.pi.appendEntry?.("advisor-manual-call", { progressId, question });
      startManualConsultation(
        runtime,
        ctx,
        question,
        controller,
        scoutStatusToken,
        progress,
        gitContext
      );
    },
  });
};
