import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";

import type { GateFailureMode, JevTransport } from "../config/types.ts";
import type { GitContextLevel } from "../git.ts";
import type { JevKeyStoreResult } from "../jev/key-store.ts";
import type {
  JevCredentials,
  JevEndpointTarget,
  JevTransportKind,
} from "../jev/transport.ts";

export interface RenderRequester {
  requestRender: () => void;
}

export interface SearchableModelSelectorOptions {
  allOptions: string[];
  currentOption?: string;
  keybindings: KeybindingsManager;
  multiSelect?: false;
  onCancel: () => void;
  onSelect: (value: string) => void;
  theme: Theme;
  title: string;
  tui: RenderRequester;
}

export interface SearchableModelMultiSelectorOptions extends Omit<
  SearchableModelSelectorOptions,
  "currentOption" | "multiSelect" | "onSelect"
> {
  currentOptions: string[];
  multiSelect: true;
  onSelect: (values: string[]) => void;
}

export interface ManualAdvisorRequest {
  /** The repository disclosure level selected for this consultation. */
  gitContext: GitContextLevel;
  /** The unnormalized message entered in the dialog, when one was supplied. */
  message?: string;
}

export interface ManualAdvisorDialogOptions {
  gitContext: GitContextLevel;
  initialMessage?: string;
  keybindings: KeybindingsManager;
  onCancel: () => void;
  onSubmit: (request: ManualAdvisorRequest) => void;
  theme: Theme;
  tui: TUI;
}

export type ManualAdvisorFocus = "editor" | "git" | "actions";

export interface ManualAdvisorDialogView {
  actionIndex: number;
  editorLines: string[];
  focusTarget: ManualAdvisorFocus;
  gitContext: GitContextLevel;
  gitIndex: number;
  gitLevels: GitContextLevel[];
  horizontalPadding: number;
  renderWidth: number;
  theme: Theme;
}

export interface ContextPreset {
  description: string;
  label: string;
  value: number;
}

export const FALLBACK_ADVISOR_MODEL_DISABLED = "Disabled (no fallback)";

export interface AdvisorSettings {
  agentsMdContext?: boolean;
  fallbackModel?: string;
  alwaysOn?: boolean;
  autoLoopGate?: boolean;
  blockOnBlocked?: boolean;
  collapseResponses: boolean;
  completionGate: boolean;
  contextMaxChars: number;
  customRule?: string;
  disableSameModel?: boolean;
  effort?: string;
  failureGate: boolean;
  failureMode?: GateFailureMode;
  gitContext?: GitContextLevel;
  gitContextMaxChars?: number;
  herdrIntegration?: boolean;
  jevBaseUrl?: string;
  jevDigestMaxChars?: number;
  jevFilterEnabled?: boolean;
  jevFilterNoulMargin?: number;
  jevFilterOverrideWindow?: number;
  jevFilterSkipConfidence?: number;
  jevKeyProvider?: string;
  jevModel?: string;
  jevPricePerMtok?: number;
  jevTimeoutMs?: number;
  jevTransport?: JevTransport;
  jevTurnGateEveryTurns?: number;
  jevTurnGateNoulThreshold?: number;
  loopThreshold?: number;
  maxCallsPerSession?: number;
  modelWhitelist?: string[];
  outcomeLogging?: boolean;
  planGate: boolean;
  redactSecrets?: boolean;
  scoutEnabled?: boolean;
  scoutTimeoutMs?: number;
  sessionSummary?: boolean;
  showUsageDetails?: boolean;
  showUsageFooter?: boolean;
  simpleMode?: boolean;
  toolPolicies?: Record<string, "full" | "summary" | "exclude">;
  toolResultMaxBytes?: number;
  toolResultMaxLines?: number;
  trackedFileContent?: boolean;
  untrackedContent?: boolean;
}

/** @deprecated Split into JevFilterSelection and JevProviderSelection, which save separately. */
export interface JevSetupSelection {
  enabled: boolean;
  transport: JevTransport;
}

export interface JevFilterSelection {
  enabled: boolean;
}

export interface JevProviderSelection {
  baseUrl?: string;
  keyProvider?: string;
  transport: JevTransport;
}

export interface JevSetupResult {
  message?: string;
  ok: boolean;
}

export interface JevSetupDeps {
  clearStoredKey?: (transport: JevTransportKind) => Promise<JevKeyStoreResult>;
  removePlaintextKey?: () => JevKeyStoreResult;
  resolveEndpoint?: (
    target: JevEndpointTarget
  ) => Promise<JevCredentials | undefined>;
  resolveTransport?: (
    transport?: JevTransportKind
  ) => Promise<JevCredentials | undefined>;
  verify?: (credentials: JevCredentials) => Promise<JevSetupResult>;
  writeKey?: (
    key: string,
    transport: JevTransportKind
  ) => Promise<JevKeyStoreResult>;
}

export interface AdvisorSettingsSelectorOptions {
  effortLevels: string[];
  initial: AdvisorSettings;
  keybindings?: KeybindingsManager;
  modelRefs?: string[];
  onCancel: () => void;
  onChange?: (settings: AdvisorSettings) => void;
  /** @deprecated Use onChange; retained for extensions embedding this component. */
  onSave?: (settings: AdvisorSettings) => void;
  presets: ContextPreset[];
  jevSetupDeps?: JevSetupDeps;
  onJevFilter?: (
    selection: JevFilterSelection,
    settings: AdvisorSettings
  ) => boolean;
  onJevProvider?: (
    selection: JevProviderSelection,
    settings: AdvisorSettings
  ) => boolean;
  /** @deprecated Use onJevFilter and onJevProvider; each is saved independently. */
  onJevSetup?: (
    selection: JevSetupSelection,
    settings: AdvisorSettings
  ) => boolean;
  theme: Theme;
  tui: RenderRequester;
}

export interface TextSettingSubmenuOptions {
  description: string;
  initial: string;
  onCancel: (value?: string) => void;
  onSubmit: (value: string) => { error?: string; value?: string };
  theme: Theme;
  title: string;
  tui: RenderRequester;
}

export type SettingValue = string | undefined;
