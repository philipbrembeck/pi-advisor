import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type {
  EntryRenderer,
  ExtensionAPI,
  MessageRenderer,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";

import { getAdvisorSettings } from "../config/state.ts";
import { isString } from "../content-utils.ts";
import { formatAdvisorUsage } from "../usage.ts";
import { adviceForDisplay, renderAdvisorCallBox } from "./render-common.ts";
import { renderScoutDetails } from "./scout-status.ts";
import type { GateDecision, ScoutToolDetails } from "./types.ts";

interface CallMessageDetails {
  question?: string;
}

interface TurnGateResultDetails {
  advisor?: string;
  text?: string;
  usage?: unknown;
}

interface LoopResultDetails {
  advisor?: string;
  decision?: GateDecision;
  text?: string;
  usage?: unknown;
}

const addUsageLine = (
  box: Box,
  details: TurnGateResultDetails | LoopResultDetails | undefined,
  theme: Theme
) => {
  if (!getAdvisorSettings().showUsageDetails) {
    return;
  }
  const usageText = formatAdvisorUsage(details?.usage);
  if (usageText) {
    box.addChild(new Text(theme.fg("dim", `  Usage: ${usageText}`), 0, 0));
  }
};

const callQuestionRenderer: MessageRenderer<CallMessageDetails> = (
  message,
  _options,
  theme
) => renderAdvisorCallBox(message.details?.question, theme);

const scoutResultRenderer: EntryRenderer<ScoutToolDetails> = (
  entry,
  { expanded },
  theme
) => {
  const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
  // SAFETY: appendScoutLifecycleEntry always stores scout details under this customType.
  renderScoutDetails(
    box,
    entry.data as ScoutToolDetails,
    Boolean(expanded),
    theme
  );
  return box;
};

const turnGateResultRenderer: MessageRenderer<TurnGateResultDetails> = (
  message,
  { expanded },
  theme
) => {
  const { details } = message;
  const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
  box.addChild(
    new Text(theme.fg("warning", theme.bold("◆ ADVISOR · TURN REVIEW")), 0, 0)
  );
  if (details?.advisor) {
    box.addChild(new Text(theme.fg("dim", `  ${details.advisor}`), 0, 0));
  }
  addUsageLine(box, details, theme);
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
          isString(message.content)
            ? message.content
            : "Advisor turn review failed."
        ),
        0,
        0
      )
    );
  }
  return box;
};

const loopResultRenderer: MessageRenderer<LoopResultDetails> = (
  message,
  { expanded },
  theme
) => {
  const { details } = message;
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
  addUsageLine(box, details, theme);
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
          isString(message.content) ? message.content : "Advisor gate failed."
        ),
        0,
        0
      )
    );
  }
  return box;
};

export const registerToolRenderers = (pi: ExtensionAPI): void => {
  pi.registerEntryRenderer?.("advisor-scout-result", scoutResultRenderer);
  pi.registerMessageRenderer?.("advisor-turn-gate-call", callQuestionRenderer);
  pi.registerMessageRenderer?.(
    "advisor-turn-gate-result",
    turnGateResultRenderer
  );
  pi.registerMessageRenderer?.("advisor-loop-call", callQuestionRenderer);
  pi.registerMessageRenderer?.("advisor-loop-result", loopResultRenderer);
};
