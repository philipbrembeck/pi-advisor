import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { GitContextLevel } from "../git.ts";
import type { ScoutLifecycleEvent } from "../scout.ts";
import type { AdvisorSessionState } from "../session-state.ts";
import type { ScoutStatusManager } from "../tools/scout-status.ts";
import type { ScoutToolDetails } from "../tools/types.ts";

export type ManualConsult = (
  ctx: ExtensionContext,
  question?: string,
  signal?: AbortSignal,
  onChunk?: (thinking: string, text: string) => void,
  onScout?: (event: ScoutLifecycleEvent) => void,
  gitContext?: GitContextLevel
) => Promise<{
  markdown: string;
  thinkingText: string;
  draftBytes?: number;
  preferenceBytes?: number;
  usage?: unknown;
}>;

export type ThinkingLevel = Parameters<ExtensionAPI["setThinkingLevel"]>[0];

export type ManualAdvisorProgressPhase =
  | "preparing"
  | "active"
  | "complete"
  | "cancelled"
  | "error";

export interface ManualAdvisorProgressState {
  phase: ManualAdvisorProgressPhase;
  scout?: ScoutToolDetails;
  text?: string;
  thinking?: string;
}

export interface CommandDependencies {
  consult?: ManualConsult;
  sessionState?: AdvisorSessionState;
  statusManager?: ScoutStatusManager;
}

export interface CommandRuntime {
  readonly advisorSessionState: AdvisorSessionState;
  flowEnabled: () => boolean;
  readonly manualConsultations: Map<AbortController, symbol>;
  readonly manualProgress: Map<string, ManualAdvisorProgressState>;
  manualProgressSequence: number;
  readonly manualProgressTimers: Map<
    AbortController,
    ReturnType<typeof setInterval>
  >;
  nextManualProgressId: () => string;
  pendingExecutorModelRef: string | undefined;
  readonly pi: ExtensionAPI;
  reportManualBudgetExhausted: (ctx: ExtensionContext) => void;
  readonly requestAdvisor: ManualConsult;
  requestManualRender: (ctx: ExtensionContext) => void;
  readonly scoutStatus: ScoutStatusManager;
  setExecutorModel: (
    model: Parameters<ExtensionAPI["setModel"]>[0]
  ) => ReturnType<ExtensionAPI["setModel"]>;
  suppressModelSelectionSync: boolean;
  updateAdvisorUsageStatus: (ctx: ExtensionContext) => void;
}
