import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component, Focusable } from "@earendil-works/pi-tui";
import { noul } from "@typesafe-ai/sdk";

import { jevClientFromCredentials } from "../jev/client.ts";
import {
  clearKeyTypeSafeKey,
  consumePlaintextKeyWarning,
  removeTypeSafeKeyFromAdvisorJson,
  writeKeyTypeSafeKey,
} from "../jev/key-store.ts";
import type { JevKeyStoreResult } from "../jev/key-store.ts";
import { resolveJevTransport } from "../jev/transport.ts";
import type { JevCredentials } from "../jev/transport.ts";
import { MaskedInput } from "./masked-input.ts";
import type { RenderRequester } from "./types.ts";

export interface JevSetupSubmenuOptions {
  currentValue: string;
  done: (selectedValue?: string) => void;
  theme: Theme;
  tui: RenderRequester;
}

export interface JevSetupDeps {
  clearStoredKey?: () => Promise<JevKeyStoreResult>;
  removePlaintextKey?: () => JevKeyStoreResult;
  resolveTransport?: () => Promise<JevCredentials | undefined>;
  verify?: (credentials: JevCredentials) => Promise<JevFailureLike>;
  writeKey?: (key: string) => Promise<JevKeyStoreResult>;
}

interface JevFailureLike {
  message?: string;
  ok: boolean;
}

type SetupMode = "menu" | "key-entry" | "verifying";
type SetupAction =
  | "verify-enable"
  | "verify-again"
  | "disable"
  | "disable-clear"
  | "enter-key"
  | "done";

const transportLabel = (credentials: JevCredentials): string => {
  if (credentials.transport === "openrouter") {
    return "OpenRouter (reusing pi login)";
  }
  switch (credentials.source) {
    case "advisor-json": {
      return "TypeSafe (key: advisor.json — plaintext, not recommended)";
    }
    case "bun-secrets": {
      return "TypeSafe (key: Bun.secrets)";
    }
    case "file": {
      return "TypeSafe (key: stored file, mode 0600)";
    }
    default: {
      return "TypeSafe (key: TYPESAFE_API_KEY)";
    }
  }
};

const defaultVerify = async (credentials: JevCredentials) => {
  const client = jevClientFromCredentials(credentials);
  try {
    await client.ask(
      { purpose: "pi-advisor setup verification" },
      { verified: noul("Answer yes.") }
    );
    return { ok: true };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
};

/** Guided Jev credentials setup: detects a reusable login, verifies live
 * before enabling, and never echoes an entered key back. */
export class JevSetupSubmenu implements Component, Focusable {
  private readonly options: JevSetupSubmenuOptions;
  private readonly deps: JevSetupDeps;
  private readonly maskedInput: MaskedInput;
  private credentials: JevCredentials | undefined;
  private mode: SetupMode = "menu";
  private notice: string | undefined;
  private selectedIndex = 0;
  private _focused = true;

  constructor(options: JevSetupSubmenuOptions, deps: JevSetupDeps = {}) {
    this.options = options;
    this.deps = {
      clearStoredKey: deps.clearStoredKey ?? clearKeyTypeSafeKey,
      removePlaintextKey:
        deps.removePlaintextKey ?? removeTypeSafeKeyFromAdvisorJson,
      resolveTransport: deps.resolveTransport ?? (() => resolveJevTransport()),
      verify: deps.verify ?? defaultVerify,
      writeKey: deps.writeKey ?? writeKeyTypeSafeKey,
    };
    this.maskedInput = new MaskedInput({
      onEscape: () => this.options.done(),
      onSubmit: (value) => this.submitEnteredKey(value),
      placeholder: "Paste a TypeSafe API key",
    });
    this.refresh().catch(() => {});
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.maskedInput.focused = value;
  }

  invalidate(): void {
    this.maskedInput.invalidate();
  }

  handleInput(keyData: string): void {
    if (this.mode === "key-entry") {
      this.maskedInput.handleInput(keyData);
      this.options.tui.requestRender();
      return;
    }
    if (this.mode !== "menu") {
      return;
    }
    const actions = this.actions();
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

  render(width: number): string[] {
    const { theme } = this.options;
    const enabled = this.options.currentValue === "On";
    const lines = [
      theme.fg("accent", theme.bold("  Jev consultation filter")),
      "",
    ];
    if (this.credentials) {
      lines.push(
        `  Transport: ${transportLabel(this.credentials)}`,
        `  Filter: ${enabled ? "On" : "Off"}`
      );
    } else if (this.mode === "verifying") {
      lines.push("  Checking available Jev credentials…");
    } else {
      lines.push(
        "  No Jev credentials found. Enter a TypeSafe API key below, or add",
        "  an OpenRouter login in pi; it is reused automatically."
      );
    }
    if (this.notice) {
      lines.push("", theme.fg("warning", `  ${this.notice}`));
    }
    lines.push("");
    if (this.mode === "verifying") {
      lines.push("  Verifying with a live Jev call…");
    } else if (this.mode === "key-entry") {
      lines.push(
        `  ${this.maskedInput.render(Math.max(10, width - 4))[0] ?? ""}`,
        theme.fg("dim", "  Enter: verify · Esc: cancel")
      );
    } else {
      for (const [index, label] of this.labels().entries()) {
        const prefix = index === this.selectedIndex ? "→ " : "  ";
        lines.push(`${prefix}${label}`);
      }
    }
    return lines.map((line) => truncateToWidth(line, width));
  }

  private actions(): SetupAction[] {
    if (!this.credentials) {
      return ["enter-key", "done"];
    }
    const enabled = this.options.currentValue === "On";
    const actions: SetupAction[] = [enabled ? "verify-again" : "verify-enable"];
    actions.push("disable");
    if (
      this.credentials.source === "bun-secrets" ||
      this.credentials.source === "file"
    ) {
      actions.push("disable-clear");
    }
    actions.push("done");
    return actions;
  }

  private actionLabels(): Record<SetupAction, string> {
    return {
      disable: "Disable",
      "disable-clear": "Disable and clear stored key",
      done: "Done",
      "enter-key": "Enter a TypeSafe API key",
      "verify-again": "Verify again",
      "verify-enable": "Verify and enable",
    };
  }

  private labels(): string[] {
    const labels = this.actionLabels();
    return this.actions().map((action) => labels[action]);
  }

  private async refresh(): Promise<void> {
    const wasVerifying = this.mode === "verifying";
    this.mode = "verifying";
    if (!wasVerifying) {
      this.options.tui.requestRender();
    }
    this.credentials = await this.deps.resolveTransport?.();
    this.mode = "menu";
    this.selectedIndex = 0;
    if (this.credentials?.source === "advisor-json") {
      this.notice ??= consumePlaintextKeyWarning();
    }
    this.options.tui.requestRender();
  }

  private activate(action: SetupAction): void {
    switch (action) {
      case "done": {
        this.options.done();
        return;
      }
      case "enter-key": {
        this.mode = "key-entry";
        return;
      }
      case "disable": {
        this.notice = undefined;
        this.options.done("Off");
        return;
      }
      case "disable-clear": {
        this.disableAndClear().catch(() => undefined);
        return;
      }
      case "verify-again":
      case "verify-enable": {
        this.verifyAndEnable().catch(() => undefined);
        return;
      }
      default: {
        return;
      }
    }
  }

  private async disableAndClear(): Promise<void> {
    const clear = this.deps.clearStoredKey;
    if (!clear) {
      return;
    }
    const result = await clear();
    this.credentials = undefined;
    this.notice = result.message;
    this.options.done("Off");
  }

  private async verifyAndEnable(): Promise<void> {
    const { credentials } = this;
    if (!(credentials && this.deps.verify)) {
      return;
    }
    this.mode = "verifying";
    this.notice = undefined;
    this.options.tui.requestRender();
    const outcome = await this.deps.verify(credentials);
    this.mode = "menu";
    if (!outcome.ok) {
      this.notice = `Verification failed: ${outcome.message ?? "unknown error"}`;
      this.options.tui.requestRender();
      return;
    }
    if (
      credentials.transport === "typesafe" &&
      credentials.source === "advisor-json"
    ) {
      const stored = await this.deps.writeKey?.(credentials.apiKey);
      if (!stored?.ok) {
        this.notice =
          stored?.message ??
          "Storing the key failed; the plaintext advisor.json key keeps working.";
        this.options.tui.requestRender();
        return;
      }
      const removed = this.deps.removePlaintextKey?.();
      this.notice = removed?.ok
        ? "Key moved from advisor.json into the secure store."
        : `Stored securely, but ${removed?.message ?? "removing the plaintext copy failed; remove it yourself."}`;
    }
    this.options.done("On");
  }

  private async submitEnteredKey(value: string): Promise<void> {
    const key = value.trim();
    if (!key) {
      return;
    }
    if (!this.deps.verify) {
      return;
    }
    this.mode = "verifying";
    this.options.tui.requestRender();
    const outcome = await this.deps.verify({
      apiKey: key,
      transport: "typesafe",
    });
    this.mode = "menu";
    if (!outcome.ok) {
      this.notice = `Verification failed: ${outcome.message ?? "unknown error"}`;
      this.options.tui.requestRender();
      return;
    }
    const stored = await this.deps.writeKey?.(key);
    if (!stored?.ok) {
      this.notice = stored?.message ?? "Storing the key failed.";
      this.options.tui.requestRender();
      return;
    }
    this.notice = `${stored.message} Verification succeeded.`;
    await this.refresh();
    this.options.done("On");
  }
}
