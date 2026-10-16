import type { ClassifierModel } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component, Focusable } from "@earendil-works/pi-tui";

import { JEV_API_KEY_CLASSIFIER } from "../config/types.ts";
import { consumeJevClassifierKey } from "../jev/classifier-key-store.ts";
import { parseJevClassifierRef } from "../jev/classifier.ts";
import type {
  JevClassifierRegistryAccess,
  JevFilterSelection,
  RenderRequester,
} from "./types.ts";

export interface JevFilterSubmenuOptions {
  currentClassifier?: string;
  currentValue: string;
  done: (selectedValue?: string) => void;
  onSelection?: (selection: JevFilterSelection) => boolean;
  modelRegistry?: JevClassifierRegistryAccess;
  resolveClassifierKey?: () => Promise<string | undefined>;
  theme: Theme;
  tui: RenderRequester;
}

type FilterAction = "disable" | "done" | "enable";

const actionsFor = (enabled: boolean): FilterAction[] =>
  enabled ? ["disable", "done"] : ["enable", "done"];

const labelFor = (action: FilterAction) => {
  if (action === "enable") {
    return "Enable the filter";
  }

  return action === "disable" ? "Disable the filter" : "Done";
};

export class JevFilterSubmenu implements Component, Focusable {
  private readonly options: JevFilterSubmenuOptions;
  private mode: "menu" | "resolving" = "resolving";
  private notice: string | undefined;
  private selectedIndex = 0;
  private enabled: boolean;
  private classifierAvailable = false;
  private readonly modelRegistry: JevClassifierRegistryAccess | undefined;
  private readonly resolveClassifierKey:
    | (() => Promise<string | undefined>)
    | undefined;
  private _focused = true;

  constructor(options: JevFilterSubmenuOptions) {
    this.options = options;
    this.modelRegistry = options.modelRegistry;
    this.resolveClassifierKey = options.resolveClassifierKey;
    this.enabled = options.currentValue === "On";
    void this.refresh();
  }

  get focused() {
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
      theme.fg("accent", theme.bold("  Jev classifier consultation filter")),
      "",
      `  Filter: ${this.enabled ? "On" : "Off"}`,
      `  Classifier: ${this.options.currentClassifier ?? "not selected"}`,
    ];

    if (this.mode === "resolving") {
      lines.push("", "  Checking selected classifier availability…");
    } else if (this.notice) {
      lines.push("", theme.fg("warning", `  ${this.notice}`));
    }

    if (this.mode === "menu") {
      lines.push("");

      for (const [index, action] of actionsFor(this.enabled).entries()) {
        lines.push(
          `${index === this.selectedIndex ? "→ " : "  "}${labelFor(action)}`
        );
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

  private async refresh() {
    const selected = this.options.currentClassifier;

    try {
      if (selected === JEV_API_KEY_CLASSIFIER) {
        this.classifierAvailable = Boolean(
          await (this.resolveClassifierKey ?? consumeJevClassifierKey)()
        );

        if (!this.classifierAvailable) {
          this.notice =
            "No Jev API Key is stored. Choose Jev API Key in Jev classifier settings.";
        }
      } else {
        const parsed = selected ? parseJevClassifierRef(selected) : undefined;
        const registry = this.modelRegistry;

        if (parsed && registry) {
          const available = await registry.getAvailableOfType(
            "classifier",
            parsed.provider
          );

          this.classifierAvailable = available.some(
            (model: ClassifierModel<string>) => model.id === parsed.modelId
          );
        }

        if (!this.classifierAvailable) {
          this.notice =
            "Select an available authenticated classifier in Jev classifier settings first.";
        }
      }
    } catch (error) {
      this.notice = `Classifier lookup failed: ${error instanceof Error ? error.message : "Pi error"}`;
    }

    this.mode = "menu";
    this.options.tui.requestRender();
  }

  private activate(action: FilterAction) {
    if (action === "done") {
      this.options.done();

      return;
    }

    const enabled = action === "enable";

    if (enabled && !this.classifierAvailable) {
      this.options.tui.requestRender();

      return;
    }

    if (this.options.onSelection?.({ enabled }) === false) {
      this.notice = "The filter state could not be saved.";
      this.options.tui.requestRender();

      return;
    }

    this.enabled = enabled;
    this.notice = undefined;
    this.options.done(enabled ? "On" : "Off");
  }
}
