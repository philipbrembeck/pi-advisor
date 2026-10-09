import { Input, Key, matchesKey } from "@earendil-works/pi-tui";
import type { Component, Focusable } from "@earendil-works/pi-tui";

import { normalizeJevBaseUrl } from "../jev/base-url.ts";
import type { JevCredentials, JevTransportKind } from "../jev/transport.ts";
import {
  renderJevProvider,
  setupActions,
} from "./jev-provider-submenu-view.ts";
import {
  canReplaceWithEnteredKey,
  consumeSetupPlaintextWarning,
  defaultSetupDeps,
  fireAndForget,
  keyEntryPrompt,
} from "./jev-setup-support.ts";
import type {
  JevProviderMode,
  JevProviderSubmenuOptions,
  JevProviderViewState,
  JevProviderAction,
} from "./jev-setup-support.ts";
import { MaskedInput } from "./masked-input.ts";
import type { JevProviderSelection, JevSetupDeps } from "./types.ts";

// Justified exception to the ~300-line guidance: one cohesive modal state machine.
export class JevProviderSubmenu implements Component, Focusable {
  private readonly options: JevProviderSubmenuOptions;
  private readonly deps: Required<JevSetupDeps>;
  private maskedInput: MaskedInput;
  private readonly textInput = new Input();
  private credentials: JevCredentials | undefined;
  private selectedTransport: JevTransportKind | undefined;
  private mode: JevProviderMode = "menu";
  private notice: string | undefined;
  private inputError: string | undefined;
  private selectedIndex = 0;
  private baseUrl: string | undefined;
  private providerId: string | undefined;
  private canEnterKey = false;
  private pendingSelectionRefresh = false;
  private _focused = true;

  constructor(options: JevProviderSubmenuOptions, deps: JevSetupDeps = {}) {
    this.options = options;
    this.deps = { ...defaultSetupDeps, ...options.setupDeps, ...deps };
    this.baseUrl = options.currentBaseUrl;
    this.providerId = options.currentKeyProvider;
    this.maskedInput = this.createMaskedInput(keyEntryPrompt("typesafe"));
    this.textInput.focused = true;
    this.textInput.onSubmit = (value) => this.submitText(value);
    this.textInput.onEscape = () => this.returnToMenu();
    void fireAndForget(this.refresh(), this.reportBackgroundError);
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.maskedInput.focused = value;
    this.textInput.focused = value;
  }

  invalidate(): void {
    this.maskedInput.invalidate();
    this.textInput.invalidate();
  }

  handleInput(keyData: string): void {
    if (this.mode === "key-entry") {
      this.maskedInput.handleInput(keyData);
      this.options.tui.requestRender();
      return;
    }
    if (this.mode === "base-url" || this.mode === "provider-id") {
      const before = this.textInput.getValue();
      this.textInput.handleInput(keyData);
      if (this.inputError && this.textInput.getValue() !== before) {
        this.inputError = undefined;
      }
      this.options.tui.requestRender();
      return;
    }
    if (this.mode !== "menu") {
      return;
    }
    const actions = setupActions(this.viewState());
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
    const input = this.mode === "key-entry" ? this.maskedInput : this.textInput;
    return renderJevProvider(this.options, this.viewState(), input, width);
  }

  private viewState(): JevProviderViewState {
    return {
      baseUrl: this.baseUrl,
      canEnterKey: this.canEnterKey,
      canReuseProviderLogin: Boolean(this.baseUrl),
      credentials: this.credentials,
      inputError: this.inputError,
      mode: this.mode,
      notice: this.notice,
      providerId: this.providerId,
      selectedIndex: this.selectedIndex,
      selectedTransport: this.selectedTransport,
    };
  }

  private createMaskedInput(placeholder: string): MaskedInput {
    return new MaskedInput({
      onEscape: () => this.returnToMenu(),
      onSubmit: (value) => this.submitEnteredKey(value),
      placeholder,
    });
  }

  private async refresh(): Promise<void> {
    this.mode = "resolving";
    this.options.tui.requestRender();
    try {
      const credentials = await this.deps.resolveTransport(
        this.options.currentTransport === "auto"
          ? undefined
          : this.options.currentTransport
      );
      this.credentials = credentials;
      this.selectedTransport = credentials?.transport;
      if (credentials?.transport === "typesafe-compatible") {
        this.baseUrl = credentials.baseUrl ?? this.baseUrl;
      }
      this.mode = "menu";
      this.selectedIndex = 0;
      if (credentials?.source === "advisor-json") {
        this.notice = consumeSetupPlaintextWarning();
      }
      this.options.tui.requestRender();
    } catch (error) {
      this.reportBackgroundError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private reportBackgroundError = (message: string): void => {
    this.mode = "menu";
    this.notice = `Setup failed: ${message}`;
    this.options.tui.requestRender();
  };

  private returnToMenu(): void {
    this.mode = "menu";
    this.inputError = undefined;
    this.maskedInput.setValue("");
    this.options.tui.requestRender();
  }

  private activate(action: JevProviderAction): void {
    if (action === "done") {
      this.closeSetup();
      return;
    }
    if (action === "clear-stored-key") {
      void fireAndForget(this.clearStoredKey(), this.reportBackgroundError);
      return;
    }
    if (action === "enter-key") {
      if (this.selectedTransport) {
        this.openKeyEntry(this.selectedTransport);
      }
      return;
    }
    if (action === "reuse-provider-login") {
      this.openProviderIdEntry();
      return;
    }
    if (action === "typesafe-compatible") {
      this.openBaseUrlEntry();
      return;
    }
    if (this.mode !== "menu") {
      return;
    }
    void fireAndForget(this.selectProvider(action), this.reportBackgroundError);
  }

  private openBaseUrlEntry(): void {
    this.mode = "base-url";
    this.inputError = undefined;
    this.notice = undefined;
    this.textInput.setValue(this.baseUrl ?? "");
    this.textInput.focused = this._focused;
    this.options.tui.requestRender();
  }

  private openProviderIdEntry(): void {
    this.mode = "provider-id";
    this.inputError = undefined;
    this.notice = undefined;
    this.textInput.setValue(this.providerId ?? "");
    this.textInput.focused = this._focused;
    this.options.tui.requestRender();
  }

  private openKeyEntry(transport: JevTransportKind): void {
    this.selectedTransport = transport;
    this.mode = "key-entry";
    this.inputError = undefined;
    this.maskedInput = this.createMaskedInput(keyEntryPrompt(transport));
    this.maskedInput.focused = this._focused;
    this.options.tui.requestRender();
  }

  private submitText(value: string): void {
    if (this.mode === "base-url") {
      void fireAndForget(this.submitBaseUrl(value), this.reportBackgroundError);
      return;
    }
    if (this.mode === "provider-id") {
      void fireAndForget(
        this.submitProviderId(value),
        this.reportBackgroundError
      );
    }
  }

  private async submitBaseUrl(value: string): Promise<void> {
    const { baseUrl, error } = normalizeJevBaseUrl(value);
    if (!baseUrl) {
      this.inputError = error;
      this.options.tui.requestRender();
      return;
    }
    this.baseUrl = baseUrl;
    this.selectedTransport = "typesafe-compatible";
    this.mode = "resolving";
    this.inputError = undefined;
    this.options.tui.requestRender();
    const options = this.providerId
      ? { baseUrl, keyProvider: this.providerId }
      : { baseUrl };
    const credentials = await this.deps.resolveEndpoint(options);
    if (!credentials) {
      this.openKeyEntry("typesafe-compatible");
      return;
    }
    await this.verifyAndSave(credentials);
  }

  private async submitProviderId(value: string): Promise<void> {
    const providerId = value.trim();
    if (!providerId || /\s/u.test(providerId)) {
      this.inputError =
        "Enter a single Pi provider id, for example openrouter.";
      this.options.tui.requestRender();
      return;
    }
    if (!this.baseUrl) {
      this.inputError = "Enter the Base URL first.";
      this.options.tui.requestRender();
      return;
    }
    this.providerId = providerId;
    this.selectedTransport = "typesafe-compatible";
    this.mode = "resolving";
    this.inputError = undefined;
    this.options.tui.requestRender();
    const credentials = await this.deps.resolveEndpoint({
      baseUrl: this.baseUrl,
      keyProvider: providerId,
    });
    if (!credentials) {
      this.mode = "menu";
      this.notice = `No stored login for Pi provider "${providerId}". Add one in Pi and retry.`;
      this.options.tui.requestRender();
      return;
    }
    await this.verifyAndSave(credentials);
  }

  private async selectProvider(transport: JevTransportKind): Promise<void> {
    this.selectedTransport = transport;
    this.mode = "resolving";
    this.notice = undefined;
    this.canEnterKey = false;
    this.options.tui.requestRender();
    let credentials: JevCredentials | undefined;
    try {
      credentials = await this.deps.resolveTransport(transport);
    } catch (error) {
      this.mode = "menu";
      this.notice = `Credential lookup failed: ${error instanceof Error ? error.message : String(error)}`;
      this.options.tui.requestRender();
      return;
    }
    this.credentials = credentials;
    this.mode = "menu";
    if (!credentials) {
      if (transport === "typesafe" || transport === "openai-decisions") {
        this.notice = undefined;
        this.openKeyEntry(transport);
      } else {
        this.notice = "No OpenRouter Pi login found. Add one in Pi and retry.";
      }
      this.options.tui.requestRender();
      return;
    }
    if (credentials.transport !== transport) {
      this.notice =
        "The selected provider did not resolve matching credentials.";
      this.options.tui.requestRender();
      return;
    }
    await this.verifyAndSave(credentials);
  }

  private async submitEnteredKey(value: string): Promise<void> {
    const transport = this.selectedTransport;
    const key = value.trim();
    this.maskedInput.setValue("");
    if (!transport || !key) {
      return;
    }
    const credentials: JevCredentials = { apiKey: key, transport };
    if (transport === "typesafe-compatible" && this.baseUrl) {
      credentials.baseUrl = this.baseUrl;
    }
    await this.verifyAndSave(credentials, key);
  }

  private async verifyAndSave(
    credentials: JevCredentials,
    enteredKey?: string
  ): Promise<void> {
    this.mode = "verifying";
    this.notice = undefined;
    this.options.tui.requestRender();
    const outcome = await this.deps.verify(credentials);
    if (!outcome.ok) {
      this.notice = `Verification failed: ${outcome.message ?? "unknown error"}`;
      this.mode = enteredKey ? "key-entry" : "menu";
      this.canEnterKey = !enteredKey && canReplaceWithEnteredKey(credentials);
      this.options.tui.requestRender();
      return;
    }
    if (enteredKey) {
      const stored = await this.deps.writeKey(
        enteredKey,
        credentials.transport
      );
      if (!stored.ok) {
        this.notice = stored.message;
        this.mode = "key-entry";
        this.canEnterKey = false;
        this.options.tui.requestRender();
        return;
      }
      this.notice = `${stored.message} Verification succeeded.`;
      // An entered key is the more explicit choice, so it clears a reused login.
      if (credentials.transport === "typesafe-compatible") {
        this.providerId = undefined;
      }
    }
    this.credentials = credentials;
    if (this.commitSelection(credentials)) {
      this.closeSetup(true);
      return;
    }
    this.mode = "menu";
    this.canEnterKey = false;
    this.notice = "Provider verified, but settings could not be saved.";
    this.options.tui.requestRender();
  }

  private commitSelection(credentials: JevCredentials): boolean {
    if (!this.options.onSelection) {
      return false;
    }
    return this.options.onSelection(this.selectionFor(credentials));
  }

  private selectionFor(credentials: JevCredentials): JevProviderSelection {
    if (credentials.transport !== "typesafe-compatible") {
      return { transport: credentials.transport };
    }
    const selection: JevProviderSelection = {
      transport: credentials.transport,
    };
    if (this.baseUrl) {
      selection.baseUrl = this.baseUrl;
    }
    if (this.providerId) {
      selection.keyProvider = this.providerId;
    }
    return selection;
  }

  private async clearStoredKey(): Promise<void> {
    const { credentials } = this;
    if (!(credentials && credentials.source)) {
      return;
    }
    this.mode = "clearing";
    this.notice = undefined;
    this.options.tui.requestRender();
    const result = await this.deps.clearStoredKey(credentials.transport);
    this.mode = "menu";
    this.notice = result.message;
    if (result.ok) {
      this.credentials = undefined;
      this.pendingSelectionRefresh = true;
    }
    this.options.tui.requestRender();
  }

  private closeSetup(refreshSettings = false): void {
    this.options.done();
    if (refreshSettings || this.pendingSelectionRefresh) {
      this.options.afterSelection?.();
    }
    this.pendingSelectionRefresh = false;
  }
}
