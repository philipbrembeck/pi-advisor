import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
  getMarkdownTheme,
  type Theme,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { getAdvisorSettings } from "../config/state.ts";
import { textFrom } from "../conversation.ts";
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
    clearInterval(context.state.timerId);
    context.state.timerId = undefined;
  }
  context.state.phase = phase;
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
    context.state.timerId = setInterval(() => context.invalidate(), 80);
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
    `${theme.fg("warning", theme.bold(`◆ ADVISOR ${frame}`))} ${theme.fg("dim", "· Working…")}`,
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

const renderFinalAdvisorResult = (
  box: Box,
  result: AgentToolResult<AdvisorToolDetails>,
  expanded: boolean,
  theme: Theme,
  context: AdvisorToolContext
) => {
  syncRenderPhase(context, "final");
  if (context.state.timerId) {
    clearInterval(context.state.timerId);
    context.state.timerId = undefined;
  }
  const details = advisorResultDetails(result);
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
  const lines = [renderAdvisorResponseHeader(hasSoundVerdict(advice), theme)];
  if (details?.advisor) {
    lines.push(theme.fg("dim", `  ${details.advisor}`));
  }
  if (getAdvisorSettings().showUsageDetails) {
    const usage = formatAdvisorUsage(details?.usage);
    if (usage) {
      lines.push(theme.fg("dim", `  Usage: ${usage}`));
    }
  }
  const attachments = [
    details?.draftBytes
      ? `Draft attached · ${details.draftBytes} B`
      : undefined,
    details?.preferenceBytes
      ? `Project preferences attached · ${details.preferenceBytes} B`
      : undefined,
    details?.trackedBytes
      ? `Tracked files attached · ${details.trackedBytes} B`
      : undefined,
    details?.untrackedBytes
      ? `Untracked files attached · ${details.untrackedBytes} B`
      : undefined,
  ].filter(Boolean);
  if (attachments.length) {
    lines.push(theme.fg("dim", `  ${attachments.join(" · ")}`));
  }
  const thinking = details?.thinking?.trim()
    ? `${details.thinking.slice(0, 300)}${details.thinking.length > 300 ? "…" : ""}`
    : "";
  const displayAdvice = advice || "(Advisor returned no advice.)";
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
      : new Box(0, 0, (text: string) => theme.bg("customMessageBg", text));
  box.setBgFn((text) => theme.bg("customMessageBg", text));
  box.clear();
  if (isPartial) {
    renderPartialAdvisorResult(box, result, expanded, theme, context);
  } else {
    renderFinalAdvisorResult(box, result, expanded, theme, context);
  }
  return box;
};
