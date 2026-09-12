import {
  getAdvisorMaxCallsPerSession,
  getAdvisorSettings,
  isSimpleMode,
} from "../config/state.ts";
import type { GitContextLevel } from "../git.ts";
import { resolveAdvisorRequest } from "../tools/render-common.ts";
import { ManualAdvisorDialog } from "../ui/manual-dialog.ts";
import type { ManualAdvisorRequest } from "../ui/types.ts";
import { loadCommandConfig } from "./activation-preparation.ts";
import { startManualConsultation } from "./manual-consultation.ts";
import type { CommandRuntime, ManualAdvisorProgressState } from "./types.ts";

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
      // Intentional fire-and-forget: the consultation streams after the command
      // handler returns. void satisfies noFloatingPromises; noVoid is ignored here
      // because this Biome version offers no ignoreVoidAsExpression option.
      // biome-ignore lint/complexity/noVoid: marks an intentional fire-and-forget promise
      void startManualConsultation(
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
