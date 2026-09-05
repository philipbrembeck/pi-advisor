import {
  type ExtensionAPI,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { getAdvisorSettings } from "../config/state.js";
import { formatAdvisorUsage } from "../usage.js";
import { adviceForDisplay, renderAdvisorCallBox } from "./render-common.js";
import { renderScoutDetails } from "./scout-status.js";
import type { GateDecision, ScoutToolDetails } from "./types.js";

export const registerToolRenderers = (pi: ExtensionAPI): void => {
  pi.registerEntryRenderer?.(
    "advisor-scout-result",
    (entry, { expanded }, theme) => {
      const scout = entry.data as ScoutToolDetails;
      const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
      renderScoutDetails(box, scout, Boolean(expanded), theme);
      return box;
    }
  );

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
        | {
            advisor?: string;
            decision?: GateDecision;
            text?: string;
            usage?: unknown;
          }
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
      if (getAdvisorSettings().showUsageDetails) {
        const usage = formatAdvisorUsage(details?.usage);
        if (usage) {
          box.addChild(new Text(theme.fg("dim", `  Usage: ${usage}`), 0, 0));
        }
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
};
