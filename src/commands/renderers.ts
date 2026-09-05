import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { getAdvisorSettings } from "../config/state.js";
import {
  adviceForDisplay,
  hasSoundVerdict,
  renderAdvisorCallBox,
  renderAdvisorResponseHeader,
} from "../tools/render-common.js";
import { formatAdvisorUsage } from "../usage.js";
import { ManualAdvisorProgressComponent } from "./manual-progress.js";
import type { CommandRuntime } from "./types.js";

export const registerCommandRenderers = (runtime: CommandRuntime) => {
  runtime.pi.registerEntryRenderer?.(
    "advisor-manual-call",
    (entry, { expanded }, theme) => {
      const { progressId, question } = (entry.data ?? {}) as {
        progressId?: string;
        question?: string;
      };
      const progress = progressId
        ? runtime.manualProgress.get(progressId)
        : undefined;
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

  runtime.pi.registerMessageRenderer?.(
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
};
