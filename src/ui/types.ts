import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import type { GateFailureMode } from "../config/types.js";
import type { GitContextLevel } from "../git.js";

export interface RenderRequester {
  requestRender: () => void;
}

export interface SearchableModelSelectorOptions {
  allOptions: string[];
  currentOption?: string;
  keybindings: KeybindingsManager;
  onCancel: () => void;
  onSelect: (value: string) => void;
  theme: Theme;
  title: string;
  tui: RenderRequester;
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

export interface AdvisorSettings {
  alwaysOn?: boolean;
  autoLoopGate?: boolean;
  blockOnBlocked?: boolean;
  collapseResponses: boolean;
  completionGate: boolean;
  contextMaxChars: number;
  customRule?: string;
  effort?: string;
  failureGate: boolean;
  failureMode?: GateFailureMode;
  gitContext?: GitContextLevel;
  gitContextMaxChars?: number;
  herdrIntegration?: boolean;
  loopThreshold?: number;
  maxCallsPerSession?: number;
  outcomeLogging?: boolean;
  planGate: boolean;
  redactSecrets?: boolean;
  scoutEnabled?: boolean;
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

export interface AdvisorSettingsSelectorOptions {
  effortLevels: string[];
  initial: AdvisorSettings;
  onCancel: () => void;
  onChange?: (settings: AdvisorSettings) => void;
  /** @deprecated Use onChange; retained for extensions embedding this component. */
  onSave?: (settings: AdvisorSettings) => void;
  presets: ContextPreset[];
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
