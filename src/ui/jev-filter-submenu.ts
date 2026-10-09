import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component, Focusable } from "@earendil-works/pi-tui";

import type { JevTransport } from "../config/types.ts";
import type { JevCredentials } from "../jev/transport.ts";
import { defaultSetupDeps, fireAndForget } from "./jev-setup-support.ts";
import type {
  JevFilterSelection,
  JevSetupDeps,
  RenderRequester,
} from "./types.ts";

export interface JevFilterSubmenuOptions {
  currentTransport: JevTransport;
  currentValue: string;
  done: (selectedValue?: string) => void;
  onSelection?: (selection: JevFilterSelection) => boolean;
  setupDeps?: JevSetupDeps;
  theme: Theme;
  tui: RenderRequester;
}

type FilterAction = "disable" | "done" | "enable";

const actionsFor = (enabled: boolean): FilterAction[] =>
  enabled ? ["disable", "done"] : ["enable", "done"];

const labelFor = (action: FilterAction): string => {
  if (action === "enable") {
    return "Enable the filter";
  }
  return action === "disable" ? "Disable the filter" : "Done";
};

/** Owns only the on/off decision plus its credential gate. */
export class JevFilterSubmenu implements Component, Focusable {
  private readonly options: JevFilterSubmenuOptions;
  private readonly deps: Required<JevSetupDeps>;
  private credentials: JevCredentials | undefined;
  private mode: "menu" | "resolving" = "resolving";
  private notice: string | undefined;
  private selectedIndex = 0;
  private enabled: boolean;
  private _focused = true;

  constructor(options: JevFilterSubmenuOptions, deps: JevSetupDeps = {}) {
    this.options = options;
    this.enabled = options.currentValue === "On";
    this.deps = { ...defaultSetupDeps, ...options.setupDeps, ...deps };
    void fireAndForget(this.refresh(), this.reportBackgroundError);
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
  }

  // oxlint-disable-next-line class-methods-use-this no-empty-function
  invalidate(): void {}

  render(width: number): string[] {
    const { theme } = this.options;
    const lines = [
      theme.fg("accent", theme.bold("  Jev/Decisions consultation filter")),
      "",
      `  Filter: ${this.enabled ? "On" : "Off"}`,
      `  Provider: ${this.options.currentTransport}`,
    ];
    if (this.mode === "resolving") {
      lines.push("", "  Checking the selected provider credentials…");
    } else if (this.notice) {
      lines.push("", theme.fg("warning", `  ${this.notice}`));
    }
    if (this.mode === "menu") {
      lines.push("");
      for (const [index, action] of actionsFor(this.enabled).entries()) {
        const prefix = index === this.selectedIndex ? "→ " : "  ";
        lines.push(`${prefix}${labelFor(action)}`);
      }
    }
    return lines.map((line) => truncateToWidth(line, width));
  }

  handleInput(keyData: string): void {
    if (this.mode !== "menu") {
      return;
    }
    const actions = actionsFor(this.enabled);
    if (
      matchesKey(keyData, Key.down) ||
      keyData === "\u001B[B" ||
      keyData === "\u001BOB"
    ) {
      this.selectedIndex = (this.selectedIndex + 1) % actions.length;
    } else if (
      matchesKey(keyData, Key.up) ||
      keyData === "\u001B[A" ||
      keyData === "\u001BOA"
    ) {
      this.selectedIndex =
        (this.selectedIndex - 1 + actions.length) % actions.length;
    } else if (matchesKey(keyData, Key.enter) || keyData === "\r") {
      this.activate(actions[this.selectedIndex]);
    } else {
      return;
    }
    this.options.tui.requestRender();
  }

  private async refresh(): Promise<void> {
    const transport = this.options.currentTransport;
    try {
      this.credentials = await this.deps.resolveTransport(
        transport === "auto" ? undefined : transport
      );
    } catch (error) {
      this.credentials = undefined;
      this.notice = `Credential lookup failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (!this.credentials && !this.notice) {
      this.notice = `No Jev provider resolves for "${transport}". Open Jev provider to configure one.`;
    }
    this.mode = "menu";
    this.options.tui.requestRender();
  }

  private reportBackgroundError = (message: string): void => {
    this.mode = "menu";
    this.notice = `Setup failed: ${message}`;
    this.options.tui.requestRender();
  };

  private activate(action: FilterAction): void {
    if (action === "done") {
      this.options.done();
      return;
    }
    const enabled = action === "enable";
    if (enabled && !this.credentials) {
      // refresh() already explains why nothing resolved.
      this.options.tui.requestRender();
      return;
    }
    const saved = this.commit({ enabled });
    if (!saved) {
      this.notice = "The filter state could not be saved.";
      this.options.tui.requestRender();
      return;
    }
    this.enabled = enabled;
    this.notice = undefined;
    this.options.done(enabled ? "On" : "Off");
  }

  private commit(selection: JevFilterSelection): boolean {
    if (!this.options.onSelection) {
      return true;
    }
    return this.options.onSelection(selection);
  }
}
