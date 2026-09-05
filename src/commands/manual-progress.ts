import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, Text } from "@earendil-works/pi-tui";
import {
  adviceForDisplay,
  renderAdvisorCallBox,
  renderThinkingMarkdown,
  SPINNER_FRAMES,
} from "../tools/render-common.js";
import { renderScoutDetails } from "../tools/scout-status.js";
import type { ManualAdvisorProgressState } from "./types.js";

export class ManualAdvisorProgressComponent implements Component {
  private readonly question: string | undefined;
  private readonly state: ManualAdvisorProgressState;
  private readonly expanded: boolean;
  private readonly theme: Theme;

  constructor(
    question: string | undefined,
    state: ManualAdvisorProgressState,
    expanded: boolean,
    theme: Theme
  ) {
    this.question = question;
    this.state = state;
    this.expanded = expanded;
    this.theme = theme;
  }

  render(width: number): string[] {
    const box = renderAdvisorCallBox(this.question, this.theme);
    if (this.state.phase === "complete" || this.state.phase === "cancelled") {
      return box.render(width);
    }

    const { scout } = this.state;
    const scoutActive =
      scout?.status === "calling" || scout?.status === "streaming";
    if (scoutActive) {
      renderScoutDetails(box, scout, this.expanded, this.theme);
      return box.render(width);
    }
    if (scout?.status === "cancelled") {
      return box.render(width);
    }
    if (this.state.phase === "error") {
      box.addChild(
        new Text(
          this.theme.fg("error", this.theme.bold("◆ ADVISOR · FAILED")),
          0,
          0
        )
      );
      return box.render(width);
    }

    const frame =
      SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
    let status = "Working…";
    if (this.state.phase === "preparing") {
      status = "Preparing…";
    } else if (this.state.text?.trim()) {
      status = "Responding…";
    }
    box.addChild(
      new Text(
        `${this.theme.fg("warning", this.theme.bold(`◆ ADVISOR ${frame}`))} ${this.theme.fg("dim", `· ${status}`)}`,
        0,
        0
      )
    );
    if (this.state.thinking?.trim()) {
      box.addChild(
        renderThinkingMarkdown(this.state.thinking.slice(-200), this.theme)
      );
    }
    if (this.state.text) {
      box.addChild(
        new Markdown(
          adviceForDisplay(this.state.text, this.expanded),
          0,
          0,
          getMarkdownTheme()
        )
      );
    }
    return box.render(width);
  }

  invalidate(): void {
    // The live progress state is read during each render.
  }
}
