import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { type Box, Text } from "@earendil-works/pi-tui";
import { executorRef, getAdvisorSettings } from "../config/state.js";
import type { ScoutLifecycleEvent } from "../scout.js";
import { formatAdvisorUsage, snapshotAdvisorUsage } from "../usage.js";
import { renderThinkingMarkdown, SPINNER_FRAMES } from "./render-common.js";
import type { ScoutToolDetails } from "./types.js";

export const scoutDetailsFromEvent = (
  event: ScoutLifecycleEvent,
  previous?: ScoutToolDetails
): ScoutToolDetails => {
  if (event.type === "call") {
    return { model: event.model, status: "calling" };
  }
  if (event.type === "chunk") {
    return {
      ...previous,
      model: event.model,
      status: "streaming",
      text: event.text,
      thinking: event.thinking,
    };
  }
  if (event.type === "cancelled") {
    return {
      model: previous ? previous.model : executorRef,
      status: "cancelled",
    };
  }
  const { outcome } = event;
  return outcome.ok
    ? {
        availableCount: outcome.metrics.availableCount,
        latencyMs: outcome.metrics.latencyMs,
        model: outcome.model,
        omittedBeforeScout: outcome.metrics.omittedBeforeScout,
        selectedCount: outcome.metrics.selectedCount,
        selectedLabels: outcome.selectedLabels,
        status: "curated",
        synthesis: outcome.selection.synthesis,
        usage: snapshotAdvisorUsage(outcome.metrics.usage),
      }
    : {
        availableCount: outcome.metrics.availableCount,
        fallbackReason: `${outcome.category}: ${outcome.message}`,
        latencyMs: outcome.metrics.latencyMs,
        model: outcome.model,
        omittedBeforeScout: outcome.metrics.omittedBeforeScout,
        selectedCount: 0,
        status: "fallback",
        usage: snapshotAdvisorUsage(outcome.metrics.usage),
      };
};

export const appendScoutLifecycleEntry = (
  pi: ExtensionAPI,
  event: ScoutLifecycleEvent,
  previous?: ScoutToolDetails
) => {
  const scout = scoutDetailsFromEvent(event, previous);
  if (
    event.type === "success" ||
    event.type === "fallback" ||
    event.type === "cancelled"
  ) {
    pi.appendEntry?.("advisor-scout-result", scout);
  }
  return scout;
};

export class ScoutStatusManager {
  readonly #active = new Set<symbol>();
  readonly #known = new Set<symbol>();
  readonly #retired = new Set<symbol>();
  private readonly showStatus: boolean;

  constructor(showStatus = true) {
    this.showStatus = showStatus;
  }

  register(token: symbol) {
    if (!this.#retired.has(token)) {
      this.#known.add(token);
    }
  }

  update(ctx: ExtensionContext, token: symbol, event: ScoutLifecycleEvent) {
    if (this.#retired.has(token) || !ctx.hasUI) {
      return;
    }
    this.#known.add(token);
    if (event.type === "call" || event.type === "chunk") {
      this.#active.add(token);
      if (this.showStatus) {
        ctx.ui.setStatus("advisor-scout", "Scout curating…");
      }
      return;
    }
    this.release(ctx, token);
  }

  release(ctx: ExtensionContext, token: symbol) {
    this.#active.delete(token);
    this.#known.delete(token);
    this.#retired.add(token);
    if (!(ctx.hasUI && this.showStatus)) {
      return;
    }
    ctx.ui.setStatus(
      "advisor-scout",
      this.#active.size > 0 ? "Scout curating…" : undefined
    );
  }

  clear(ctx: ExtensionContext) {
    for (const token of this.#known) {
      this.#retired.add(token);
    }
    this.#known.clear();
    this.#active.clear();
    if (ctx.hasUI && this.showStatus) {
      ctx.ui.setStatus("advisor-scout", undefined);
    }
  }
}

const scoutTitle = (scout: ScoutToolDetails, frame: string) => {
  if (scout.status === "calling" || scout.status === "streaming") {
    return `◆ SCOUT ${frame} · CURATING…`;
  }
  if (scout.status === "curated") {
    return "◆ SCOUT · CURATED";
  }
  if (scout.status === "cancelled") {
    return "◆ SCOUT · CANCELLED";
  }
  return "◆ SCOUT · FALLBACK";
};

export const renderScoutDetails = (
  box: Box,
  scout: ScoutToolDetails,
  expanded: boolean,
  theme: Theme
) => {
  const active = scout.status === "calling" || scout.status === "streaming";
  const frame =
    SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
  const title = scoutTitle(scout, frame);
  const lines = [
    theme.fg(
      scout.status === "fallback" || scout.status === "cancelled"
        ? "warning"
        : "accent",
      theme.bold(title)
    ),
    theme.fg(
      "dim",
      `  ${scout.model}${scout.selectedCount === undefined ? "" : ` · ${scout.selectedCount} kept / ${Math.max(0, (scout.availableCount ?? 0) - scout.selectedCount)} omitted`}${scout.latencyMs === undefined ? "" : ` · ${(scout.latencyMs / 1000).toFixed(1)}s`}`
    ),
  ];
  if (getAdvisorSettings().showUsageDetails) {
    const usage = formatAdvisorUsage(scout.usage);
    if (usage) {
      lines.push(theme.fg("dim", `  Usage: ${usage}`));
    }
  }
  if (scout.fallbackReason) {
    lines.push(theme.fg("warning", `  ${scout.fallbackReason}`));
  }
  const thinking = scout.thinking && active ? scout.thinking.slice(-200) : "";
  box.addChild(new Text(lines.join("\n"), 0, 0));
  if (thinking.trim()) {
    box.addChild(renderThinkingMarkdown(thinking, theme));
  }
  const expandedLines: string[] = [];
  if (expanded && scout.selectedLabels?.length) {
    expandedLines.push(
      theme.fg("dim", `  Selected: ${scout.selectedLabels.join("; ")}`)
    );
  }
  if (expanded && scout.synthesis) {
    expandedLines.push(
      theme.fg(
        "dim",
        `  Scout synthesis (untrusted inference): ${scout.synthesis}`
      )
    );
  }
  if (expanded && scout.omittedBeforeScout) {
    expandedLines.push(
      theme.fg(
        "dim",
        `  ${scout.omittedBeforeScout} group(s) omitted before Scout`
      )
    );
  }
  if (expandedLines.length > 0) {
    box.addChild(new Text(expandedLines.join("\n"), 0, 0));
  }
};
