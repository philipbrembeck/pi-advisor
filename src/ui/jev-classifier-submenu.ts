import type { ClassifierModel } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey } from "@earendil-works/pi-tui";
import type {
  Component,
  Focusable,
  KeybindingsManager,
} from "@earendil-works/pi-tui";

import { JEV_API_KEY_CLASSIFIER } from "../config/types.ts";
import {
  consumeJevClassifierKey,
  disableJevClassifierKeyForRuntime,
  enableJevClassifierKeyForRuntime,
  restoreJevClassifierKey,
  writeJevClassifierKey,
} from "../jev/classifier-key-store.ts";
import { classifyWithJev } from "../jev/classifier.ts";
import { nativeScreeningQuestions } from "../jev/questions.ts";
import { MaskedInput } from "./masked-input.ts";
import type {
  JevClassifierRegistryAccess,
  JevProviderSelection,
  RenderRequester,
} from "./types.ts";

interface Options {
  currentValue: string;
  done: (value?: string) => void;
  keybindings: KeybindingsManager;
  modelRegistry?: JevClassifierRegistryAccess;
  onSelection?: (selection: JevProviderSelection) => boolean;
  resolveStoredKey?: () => Promise<string | undefined>;
  persistKey?: (key: string) => Promise<{ ok: boolean; message: string }>;
  restoreKey?: (previous: string | undefined) => Promise<boolean>;
  theme: Theme;
  tui: RenderRequester;
}

interface Choice {
  action: "classifier" | "use-key" | "replace-key";
  label: string;
  model?: ClassifierModel<string>;
  ref: string;
}

export class JevClassifierSubmenu implements Component, Focusable {
  private readonly options: Options;
  private readonly search = new Input();
  private readonly loaded = Promise.withResolvers<boolean>();
  private keyInput: MaskedInput | undefined;
  private choices: Choice[] = [];
  private filtered: Choice[] = [];
  private selectedIndex = 0;
  private mode: "loading" | "list" | "key" | "verifying" = "loading";
  private notice: string | undefined;
  private failClosedKeyMode = false;
  private _focused = true;

  constructor(options: Options) {
    this.options = options;
    this.search.focused = true;
    void this.loadChoices();
  }

  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.search.focused = value;
  }
  invalidate(): void {
    this.search.invalidate();
  }
  render(width: number): string[] {
    const { theme } = this.options;
    const border = theme.fg("border", "─".repeat(Math.max(1, width)));

    if (this.mode === "key") {
      return [
        border,
        theme.fg("accent", theme.bold("Jev API Key")),
        "",
        this.notice ?? "Enter a new TypeSafe Jev API key:",
        `  ${this.keyInput?.render(Math.max(1, width - 4))[0] ?? ""}`,
        "",
        this.failClosedKeyMode
          ? "Key restore failed. Re-enter and verify a valid Jev key."
          : "Enter to verify · Esc to cancel",
        border,
      ];
    }

    const query = this.search.getValue().trim().toLowerCase();

    const filteredChoices = this.choices.filter((choice) =>
      choice.label.toLowerCase().includes(query)
    );

    this.filtered = filteredChoices;

    const rows = this.filtered.map(
      (choice, index) =>
        `${index === this.selectedIndex ? "›" : " "} ${choice.label}`
    );

    return [
      border,
      theme.fg("accent", theme.bold("Jev classifier")),
      "",
      this.mode === "loading"
        ? "Loading Pi classifier catalog…"
        : `Search: ${this.search.render(Math.max(1, width - 10))[0]}`,
      ...(this.notice ? [this.notice] : []),
      ...rows.slice(0, 10),
      "",
      "↑/↓ move · Enter select · Esc cancel",
      border,
    ];
  }

  handleInput(data: string): void {
    if (this.mode === "key") {
      this.keyInput?.handleInput(data);

      this.options.tui.requestRender();

      return;
    }

    if (this.mode !== "list") {
      return;
    }

    if (data === "\u001B[B" || matchesKey(data, Key.down)) {
      if (this.selectedIndex + 1 < this.filtered.length) {
        this.selectedIndex += 1;
      }
    } else if (data === "\u001B[A" || matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    } else if (matchesKey(data, Key.escape) || data === "\u001B") {
      this.options.done();

      return;
    } else if (matchesKey(data, Key.enter) || data === "\r") {
      const selected = this.filtered[this.selectedIndex];

      if (selected) {
        void this.choose(selected);
      }
    } else {
      this.search.handleInput(data);
      this.selectedIndex = 0;
    }

    this.options.tui.requestRender();
  }

  private async loadChoices() {
    try {
      if (!this.options.modelRegistry) {
        throw new Error("Pi classifier registry is unavailable.");
      }

      const models =
        await this.options.modelRegistry.getAvailableOfType("classifier");

      this.choices = (models ?? []).map((model: ClassifierModel<string>) => ({
        action: "classifier" as const,
        label: `${this.options.modelRegistry?.getProviderDisplayName(model.provider) ?? model.provider} / ${model.id} (${JevClassifierSubmenu.rates(model)})`,
        model,
        ref: `${model.provider}/${model.id}`,
      }));

      const storedKey = await (
        this.options.resolveStoredKey ?? consumeJevClassifierKey
      )();

      if (storedKey) {
        this.choices.push(
          {
            action: "use-key",
            label: "Jev API Key (use stored key)",
            ref: JEV_API_KEY_CLASSIFIER,
          },
          {
            action: "replace-key",
            label: "Replace Jev API Key…",
            ref: JEV_API_KEY_CLASSIFIER,
          }
        );
      } else {
        this.choices.push({
          action: "replace-key",
          label: "Jev API Key… (enter TypeSafe key)",
          ref: JEV_API_KEY_CLASSIFIER,
        });
      }

      this.mode = "list";
      this.loaded.resolve(true);
      this.notice =
        this.options.currentValue &&
        this.options.currentValue !== "Choose classifier"
          ? `Current: ${this.options.currentValue}`
          : undefined;
    } catch (error) {
      this.mode = "list";
      this.loaded.resolve(false);
      this.notice = `Could not load classifiers: ${error instanceof Error ? error.message : "unknown error"}. Retry /advisor-settings.`;
    }

    this.options.tui.requestRender();
  }

  whenLoaded() {
    return this.loaded.promise;
  }

  private static rates(model: ClassifierModel<string>) {
    const rates = model.cost;

    return rates.input === 0 && rates.output === 0
      ? "$0/M tokens"
      : `$${rates.input}/$${rates.output} per Mtok`;
  }

  private async choose(choice: Choice) {
    if (choice.action === "use-key") {
      const key = await (
        this.options.resolveStoredKey ?? consumeJevClassifierKey
      )();

      if (key) {
        await this.verifyStoredKey(key);
      } else {
        this.openKeyEntry();
      }

      return;
    }

    if (choice.action === "replace-key") {
      this.openKeyEntry();

      return;
    }

    if (!choice.model) {
      return;
    }

    this.mode = "verifying";
    this.notice = `Verifying ${choice.ref}…`;
    this.options.tui.requestRender();

    try {
      await this.verify(choice.model);
      const saved = this.save({ classifier: choice.ref, transport: "auto" });

      if (!saved) {
        this.mode = "list";
        this.notice = "Verified, but settings could not be saved.";
      }
    } catch (error) {
      this.notice = `Verification failed for ${choice.ref}: ${error instanceof Error ? error.message : "provider error"}`;
      this.mode = "list";
    }

    this.options.tui.requestRender();
  }

  private async verify(model: ClassifierModel<string>, apiKey?: string) {
    if (!this.options.modelRegistry) {
      throw new Error("Pi classifier registry is unavailable.");
    }

    const state = {
      recent_conversation: "Classifier verification check.",
      role: "executor",
    };

    const result = await classifyWithJev(
      { modelRegistry: this.options.modelRegistry, signal: undefined },
      `${model.provider}/${model.id}`,
      state,
      nativeScreeningQuestions,
      { apiKey }
    );

    if (!result.answers.self_answerable || !result.answers.stakes) {
      throw new Error("Classifier returned an incomplete verification result.");
    }
  }

  private async verifyKey() {
    const candidate = this.keyInput?.getValue().trim() ?? "";
    this.keyInput?.setValue("");

    if (!candidate) {
      this.notice = "Enter a non-empty Jev API key.";
      this.options.tui.requestRender();

      return;
    }

    const model = this.options.modelRegistry?.findOfType(
      "classifier",
      "typesafe",
      "jev-latest"
    );

    if (!model) {
      this.notice = "TypeSafe Jev classifier is not present in Pi's catalog.";
      this.options.tui.requestRender();

      return;
    }

    this.mode = "verifying";
    this.notice = "Verifying Jev API Key…";
    this.options.tui.requestRender();

    const previous = await (
      this.options.resolveStoredKey ?? consumeJevClassifierKey
    )();

    try {
      await this.verify(model, candidate);

      const stored = await (this.options.persistKey ?? writeJevClassifierKey)(
        candidate
      );

      if (!stored.ok) {
        throw new Error(stored.message);
      }

      enableJevClassifierKeyForRuntime();

      if (
        !this.save({ classifier: JEV_API_KEY_CLASSIFIER, transport: "auto" })
      ) {
        if (!(await this.restorePreviousKey(previous))) {
          this.failClosedKeyMode = true;
          disableJevClassifierKeyForRuntime();
          throw new Error(
            "Settings save failed and the previous key could not be restored. Re-enter and verify a valid Jev key before continuing."
          );
        }

        throw new Error(
          "Could not save Jev classifier settings; existing key was restored."
        );
      }

      this.mode = "list";
      this.notice = "Jev API Key verified and saved securely.";
    } catch (error) {
      this.mode = "key";
      this.notice = `Verification failed: ${error instanceof Error ? error.message : "provider error"}`;
    }

    this.options.tui.requestRender();
  }

  private openKeyEntry() {
    this.mode = "key";
    this.keyInput = new MaskedInput({
      onEscape: () => {
        this.mode = "list";
        this.keyInput?.setValue("");
        this.options.tui.requestRender();
      },
      onSubmit: () => this.handleKeySubmit(),
      placeholder: "TypeSafe Jev API key",
    });
  }

  private restorePreviousKey(key: string | undefined): Promise<boolean> {
    if (this.options.restoreKey) {
      return this.options.restoreKey(key);
    }

    const snapshot = key ? { key } : {};

    return restoreJevClassifierKey(snapshot);
  }

  private async verifyStoredKey(key: string) {
    const model = this.options.modelRegistry?.findOfType(
      "classifier",
      "typesafe",
      "jev-latest"
    );

    if (!model) {
      this.notice = "TypeSafe Jev classifier is not present in Pi's catalog.";
      this.options.tui.requestRender();

      return;
    }

    this.mode = "verifying";
    this.notice = "Verifying stored Jev API Key…";
    this.options.tui.requestRender();

    try {
      await this.verify(model, key);

      if (
        !this.save({ classifier: JEV_API_KEY_CLASSIFIER, transport: "auto" })
      ) {
        throw new Error("Could not save the Jev classifier selection.");
      }

      this.notice = "Stored Jev API Key verified.";
    } catch (error) {
      this.mode = "list";
      this.notice = `Verification failed: ${error instanceof Error ? error.message : "provider error"}`;
    }

    this.options.tui.requestRender();
  }

  private async handleKeySubmit() {
    try {
      await this.verifyKey();
    } catch (error) {
      this.notice = `Verification failed: ${error instanceof Error ? error.message : "provider error"}`;
      this.mode = "key";
      this.options.tui.requestRender();
    }
  }

  private save(selection: JevProviderSelection) {
    const saved = this.options.onSelection?.(selection) ?? false;

    if (saved) {
      this.options.done(selection.classifier);
    } else {
      this.mode = "list";
      this.notice = "Verified, but settings could not be saved.";
    }

    return saved;
  }
}
