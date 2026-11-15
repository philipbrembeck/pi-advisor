import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";

import { getAdvisorSettings } from "../config/state.ts";
import { textFrom } from "../conversation.ts";
import { t } from "../i18n.ts";
import { formatAdvisorUsage } from "../usage.ts";
import {
  adviceForDisplay,
  hasSoundVerdict,
  renderAdvisorResponseHeader,
  renderThinkingMarkdown,
  SPINNER_FRAMES,
} from "./render-common.ts";
import { renderScoutDetails } from "./scout-status.ts";
import type { AdvisorToolContext, AdvisorToolDetails } from "./types.ts";

const advisorResultDetails = (result: AgentToolResult<AdvisorToolDetails>) =>
  result.details;

const syncRenderPhase = (context: AdvisorToolContext, phase: string) => {
  if (context.state.phase !== phase && context.state.timerId) {
    clearTimeout(context.state.timerId);
    context.state.timerId = undefined;
  }

  context.state.phase = phase;
};

const scheduleRender = (context: AdvisorToolContext) => {
  const timer = setTimeout(() => {
    if (context.state.timerId !== timer) {
      return;
    }

    context.state.timerId = undefined;

    try {
      context.invalidate();
    } catch {
      // The render slot may have been discarded before the repaint fired.
    }
  }, 80);

  context.state.timerId = timer;
};

const formatByteSize = (bytes: number): string => {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  }

  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KiB`;
  }

  return `${bytes} B`;
};

const attachmentLabels = (details: AdvisorToolDetails | undefined) =>
  [
    details?.agentRulesBytes
      ? `AGENTS.md rules attached · ${formatByteSize(details.agentRulesBytes)}`
      : undefined,
    details?.draftBytes
      ? `Draft attached · ${formatByteSize(details.draftBytes)}`
      : undefined,
    details?.preferenceBytes
      ? `Project preferences attached · ${formatByteSize(details.preferenceBytes)}`
      : undefined,
    details?.trackedBytes
      ? `${t("render.trackedAttached", "Tracked files attached")} · ${formatByteSize(details.trackedBytes)}`
      : undefined,
    details?.untrackedBytes
      ? `${t("render.untrackedAttached", "Untracked files attached")} · ${formatByteSize(details.untrackedBytes)}`
      : undefined,
    details?.imageCount
      ? `${details.imageCount} ${details.imageCount === 1 ? t("render.image", "image") : t("render.images", "images")} ${t("render.attached", "attached")}${details.imageBytes ? ` · ${formatByteSize(details.imageBytes)}` : ""}${details.imageOmissions ? ` · ${details.imageOmissions} ${t("render.withheld", "withheld")}` : ""}`
      : undefined,
  ].filter((label): label is string => label !== undefined);

const renderSkipBox = (
  box: Box,
  result: AgentToolResult<AdvisorToolDetails>,
  expanded: boolean,
  theme: Theme
) => {
  const details = advisorResultDetails(result);

  const lines = [
    theme.fg(
      "dim",
      theme.bold(`◆ ADVISOR · ${t("render.skipped", "SKIPPED")}`)
    ),
    theme.fg("dim", `  ${details?.skipReason ?? details?.jev?.reason ?? ""}`),
  ];

  box.addChild(new Text(lines.join("\n"), 0, 0));
  box.addChild(
    new Markdown(
      adviceForDisplay(textFrom(result.content), expanded),
      0,
      0,
      getMarkdownTheme()
    )
  );
};

const renderPartialAdvisorResult = (
  box: Box,
  result: AgentToolResult<AdvisorToolDetails>,
  expanded: boolean,
  theme: Theme,
  context: AdvisorToolContext
) => {
  const details = advisorResultDetails(result);

  if (details?.scout) {
    context.state.scout = details.scout;
  }

  const scout = details?.scout ?? context.state.scout;

  const scoutActive =
    scout?.status === "calling" || scout?.status === "streaming";

  syncRenderPhase(context, scoutActive ? "scout" : "advisor");

  if (!context.state.timerId) {
    scheduleRender(context);
  }

  if (scout) {
    renderScoutDetails(box, scout, expanded, theme);
  }

  if (scoutActive || scout?.status === "cancelled") {
    return;
  }

  const frame =
    SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];

  const lines = [
    `${theme.fg("warning", theme.bold(`◆ ADVISOR ${frame}`))} ${theme.fg("dim", `· ${t("render.working", "Working…")}`)}`,
  ];

  box.addChild(new Text(lines.join("\n"), 0, 0));

  if (details?.thinking?.trim()) {
    const thought =
      details.thinking.length > 200
        ? details.thinking.slice(-200)
        : details.thinking;

    box.addChild(renderThinkingMarkdown(thought, theme));
  }

  if (details?.text) {
    box.addChild(
      new Markdown(
        adviceForDisplay(details.text, expanded),
        0,
        0,
        getMarkdownTheme()
      )
    );
  }
};

const thinkingPreview = (details: AdvisorToolDetails | undefined) =>
  details?.thinking?.trim()
    ? `${details.thinking.slice(0, 300)}${details.thinking.length > 300 ? "…" : ""}`
    : "";

const finalResultLines = (
  details: AdvisorToolDetails | undefined,
  advice: string,
  theme: Theme
): string[] => {
  const lines = [renderAdvisorResponseHeader(hasSoundVerdict(advice), theme)];

  if (details?.followUp) {
    lines.push(
      theme.fg(
        "dim",
        `  ${t("render.followUpConsultation", "Follow-up consultation")}`
      )
    );
  }

  if (details?.advisor) {
    lines.push(theme.fg("dim", `  ${details.advisor}`));
  }

  if (getAdvisorSettings().showUsageDetails) {
    const usage = formatAdvisorUsage(details?.usage);

    if (usage) {
      lines.push(theme.fg("dim", `  ${t("render.usage", "Usage:")} ${usage}`));
    }
  }

  const attachments = attachmentLabels(details);

  if (attachments.length) {
    lines.push(theme.fg("dim", `  ${attachments.join(" · ")}`));
  }

  return lines;
};

const renderFinalAdvisorResult = (
  box: Box,
  result: AgentToolResult<AdvisorToolDetails>,
  expanded: boolean,
  theme: Theme,
  context: AdvisorToolContext
) => {
  syncRenderPhase(context, "final");

  if (context.state.timerId) {
    clearTimeout(context.state.timerId);
    context.state.timerId = undefined;
  }

  const details = advisorResultDetails(result);

  if (details?.jev?.skipped || details?.skipReason) {
    renderSkipBox(box, result, expanded, theme);

    return;
  }

  if (details?.scout) {
    context.state.scout = details.scout;
  }

  const scout = details?.scout ?? context.state.scout;

  if (scout) {
    renderScoutDetails(box, scout, expanded, theme);
  }

  if (scout?.status === "cancelled") {
    return;
  }

  const advice = details?.text || textFrom(result.content);
  const thinking = thinkingPreview(details);
  const lines = finalResultLines(details, advice, theme);

  const displayAdvice =
    advice || t("render.noAdvice", "(Advisor returned no advice.)");

  box.addChild(new Text(lines.join("\n"), 0, 0));

  if (thinking) {
    box.addChild(renderThinkingMarkdown(thinking, theme));
  }

  box.addChild(
    new Markdown(
      adviceForDisplay(displayAdvice, expanded),
      0,
      0,
      getMarkdownTheme()
    )
  );
};

export const renderAdvisorResult = (
  result: AgentToolResult<AdvisorToolDetails>,
  { isPartial, expanded }: ToolRenderResultOptions,
  theme: Theme,
  context: AdvisorToolContext
) => {
  // Pi frames this inside its own padded tool box; padding here doubles the gap below the request.
  const box =
    context.lastComponent instanceof Box
      ? context.lastComponent
      : new Box(1, 0, (text: string) => theme.bg("customMessageBg", text));

  box.setBgFn((text) => theme.bg("customMessageBg", text));
  box.clear();

  if (isPartial) {
    renderPartialAdvisorResult(box, result, expanded, theme, context);
  } else {
    renderFinalAdvisorResult(box, result, expanded, theme, context);
  }

  // Restores the bottom breathing room the removed vertical padding provided.
  box.addChild(new Spacer(1));

  return box;
};
