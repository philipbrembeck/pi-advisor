import { describe, expect, test } from "bun:test";
import { registerCommands as leafRegisterCommands } from "../src/commands/registration.ts";
import type {
  CommandDependencies,
  ManualAdvisorProgressPhase,
  ManualAdvisorProgressState,
  ManualConsult,
  ThinkingLevel,
} from "../src/commands.ts";
import { registerCommands as facadeRegisterCommands } from "../src/commands.ts";
import {
  contextMaxCharsRef as leafContextMaxCharsRef,
  setContextMaxCharsRef as leafSetContextMaxCharsRef,
} from "../src/config/state.ts";
import { loadConfig as leafLoadConfig } from "../src/config/storage.ts";
import { DEFAULT_CONTEXT_MAX_CHARS as leafDefaultContextMaxChars } from "../src/config/types.ts";
import { validateConfig as leafValidateConfig } from "../src/config/validation.ts";
import type {
  AdvisorConfig,
  AdvisorToolPolicies,
  AdvisorToolPolicy,
  GateFailureMode,
  SaveConfigOptions,
} from "../src/config.ts";
import {
  contextMaxCharsRef as facadeContextMaxCharsRef,
  DEFAULT_CONTEXT_MAX_CHARS as facadeDefaultContextMaxChars,
  loadConfig as facadeLoadConfig,
  setContextMaxCharsRef as facadeSetContextMaxCharsRef,
  validateConfig as facadeValidateConfig,
} from "../src/config.ts";
import {
  consultAdvisor as leafConsultAdvisor,
  curateAdvisorConversation as leafCurateAdvisorConversation,
  runAdvisorGate as leafRunAdvisorGate,
} from "../src/tools/consultation.ts";
import { gateFailureEffectForMode as leafGateFailureEffectForMode } from "../src/tools/gate-policy.ts";
import { parseAutomaticDecision as leafParseAutomaticDecision } from "../src/tools/gate-protocol.ts";
import {
  ADVISOR_DECISION_SYSTEM as leafAdvisorDecisionSystem,
  advisorGitContextBudget as leafAdvisorGitContextBudget,
  advisorInvocationGuidelines as leafAdvisorInvocationGuidelines,
  advisorMessageText as leafAdvisorMessageText,
  advisorRepositoryContext as leafAdvisorRepositoryContext,
  advisorRequestConversation as leafAdvisorRequestConversation,
  ADVISOR_SYSTEM as leafAdvisorSystem,
  gitContextNote as leafGitContextNote,
} from "../src/tools/prompts.ts";
import { registerAdvisorTool as leafRegisterAdvisorTool } from "../src/tools/registration.ts";
import {
  adviceForDisplay as leafAdviceForDisplay,
  hasSoundVerdict as leafHasSoundVerdict,
  renderAdvisorCallBox as leafRenderAdvisorCallBox,
  renderAdvisorResponseHeader as leafRenderAdvisorResponseHeader,
  renderThinkingMarkdown as leafRenderThinkingMarkdown,
  resolveAdvisorRequest as leafResolveAdvisorRequest,
  SPINNER_FRAMES as leafSpinnerFrames,
} from "../src/tools/render-common.ts";
import {
  appendScoutLifecycleEntry as leafAppendScoutLifecycleEntry,
  renderScoutDetails as leafRenderScoutDetails,
  scoutDetailsFromEvent as leafScoutDetailsFromEvent,
  ScoutStatusManager as leafScoutStatusManager,
} from "../src/tools/scout-status.ts";
import { advisorSessionState as leafAdvisorSessionState } from "../src/tools/session.ts";
import type {
  AdvisorConsultationResult,
  AdvisorGateFailure,
  AdvisorGateOutcome,
  AdvisorGateResult,
  AdvisorInvocationRecord,
  ConsultationTrigger,
  GateDecision,
  GateFailureCategory,
  GateTrigger,
  ScoutToolDetails,
} from "../src/tools.ts";
import {
  adviceForDisplay as facadeAdviceForDisplay,
  ADVISOR_DECISION_SYSTEM as facadeAdvisorDecisionSystem,
  advisorGitContextBudget as facadeAdvisorGitContextBudget,
  advisorInvocationGuidelines as facadeAdvisorInvocationGuidelines,
  advisorMessageText as facadeAdvisorMessageText,
  advisorRepositoryContext as facadeAdvisorRepositoryContext,
  advisorRequestConversation as facadeAdvisorRequestConversation,
  advisorSessionState as facadeAdvisorSessionState,
  ADVISOR_SYSTEM as facadeAdvisorSystem,
  appendScoutLifecycleEntry as facadeAppendScoutLifecycleEntry,
  consultAdvisor as facadeConsultAdvisor,
  curateAdvisorConversation as facadeCurateAdvisorConversation,
  gateFailureEffectForMode as facadeGateFailureEffectForMode,
  gitContextNote as facadeGitContextNote,
  hasSoundVerdict as facadeHasSoundVerdict,
  parseAutomaticDecision as facadeParseAutomaticDecision,
  registerAdvisorTool as facadeRegisterAdvisorTool,
  renderAdvisorCallBox as facadeRenderAdvisorCallBox,
  renderAdvisorResponseHeader as facadeRenderAdvisorResponseHeader,
  renderScoutDetails as facadeRenderScoutDetails,
  renderThinkingMarkdown as facadeRenderThinkingMarkdown,
  resolveAdvisorRequest as facadeResolveAdvisorRequest,
  runAdvisorGate as facadeRunAdvisorGate,
  scoutDetailsFromEvent as facadeScoutDetailsFromEvent,
  ScoutStatusManager as facadeScoutStatusManager,
  SPINNER_FRAMES as facadeSpinnerFrames,
} from "../src/tools.ts";
import { ManualAdvisorDialog as leafManualAdvisorDialog } from "../src/ui/manual-dialog.ts";
import { SearchableModelSelector as leafSearchableModelSelector } from "../src/ui/model-selector.ts";
import { AdvisorSettingsSelector as leafAdvisorSettingsSelector } from "../src/ui/settings-selector.ts";
import type {
  AdvisorSettings,
  ContextPreset,
  ManualAdvisorRequest,
} from "../src/ui.ts";
import {
  AdvisorSettingsSelector as facadeAdvisorSettingsSelector,
  ManualAdvisorDialog as facadeManualAdvisorDialog,
  SearchableModelSelector as facadeSearchableModelSelector,
} from "../src/ui.ts";

export interface CommandsFacadeTypeInventory {
  consult: ManualConsult;
  dependencies: CommandDependencies;
  phase: ManualAdvisorProgressPhase;
  progress: ManualAdvisorProgressState;
  thinking: ThinkingLevel;
}

export interface ConfigFacadeTypeInventory {
  config: AdvisorConfig;
  mode: GateFailureMode;
  options: SaveConfigOptions;
  policies: AdvisorToolPolicies;
  policy: AdvisorToolPolicy;
}

export interface UiFacadeTypeInventory {
  context: ContextPreset;
  request: ManualAdvisorRequest;
  settings: AdvisorSettings;
}

export interface ToolsFacadeTypeInventory {
  category: GateFailureCategory;
  consultation: AdvisorConsultationResult;
  consultationTrigger: ConsultationTrigger;
  decision: GateDecision;
  failure: AdvisorGateFailure;
  gate: AdvisorGateOutcome;
  gateTrigger: GateTrigger;
  invocation: AdvisorInvocationRecord;
  result: AdvisorGateResult;
  scout: ScoutToolDetails;
}

describe("command compatibility facade", () => {
  test("re-exports command registration from its owning leaf module", () => {
    expect(facadeRegisterCommands).toBe(leafRegisterCommands);
  });
});

describe("config compatibility facade", () => {
  test("re-exports values from their owning leaf modules", () => {
    expect(facadeDefaultContextMaxChars).toBe(leafDefaultContextMaxChars);
    expect(facadeContextMaxCharsRef).toBe(leafContextMaxCharsRef);
    expect(facadeSetContextMaxCharsRef).toBe(leafSetContextMaxCharsRef);
    expect(facadeValidateConfig).toBe(leafValidateConfig);
    expect(facadeLoadConfig).toBe(leafLoadConfig);
  });

  test("re-exports UI constructors from their owning leaf modules", () => {
    expect(facadeManualAdvisorDialog).toBe(leafManualAdvisorDialog);
    expect(facadeSearchableModelSelector).toBe(leafSearchableModelSelector);
    expect(facadeAdvisorSettingsSelector).toBe(leafAdvisorSettingsSelector);
  });

  test("re-exports tool values from their owning leaf modules", () => {
    expect(facadeAdvisorSessionState).toBe(leafAdvisorSessionState);
    expect(facadeSpinnerFrames).toBe(leafSpinnerFrames);
    expect(facadeRenderThinkingMarkdown).toBe(leafRenderThinkingMarkdown);
    expect(facadeHasSoundVerdict).toBe(leafHasSoundVerdict);
    expect(facadeRenderAdvisorResponseHeader).toBe(
      leafRenderAdvisorResponseHeader
    );
    expect(facadeResolveAdvisorRequest).toBe(leafResolveAdvisorRequest);
    expect(facadeAdviceForDisplay).toBe(leafAdviceForDisplay);
    expect(facadeRenderAdvisorCallBox).toBe(leafRenderAdvisorCallBox);
    expect(facadeAdvisorSystem).toBe(leafAdvisorSystem);
    expect(facadeAdvisorDecisionSystem).toBe(leafAdvisorDecisionSystem);
    expect(facadeAdvisorGitContextBudget).toBe(leafAdvisorGitContextBudget);
    expect(facadeAdvisorInvocationGuidelines).toBe(
      leafAdvisorInvocationGuidelines
    );
    expect(facadeAdvisorMessageText).toBe(leafAdvisorMessageText);
    expect(facadeAdvisorRepositoryContext).toBe(leafAdvisorRepositoryContext);
    expect(facadeAdvisorRequestConversation).toBe(
      leafAdvisorRequestConversation
    );
    expect(facadeGitContextNote).toBe(leafGitContextNote);
    expect(facadeParseAutomaticDecision).toBe(leafParseAutomaticDecision);
    expect(facadeConsultAdvisor).toBe(leafConsultAdvisor);
    expect(facadeCurateAdvisorConversation).toBe(leafCurateAdvisorConversation);
    expect(facadeRunAdvisorGate).toBe(leafRunAdvisorGate);
    expect(facadeGateFailureEffectForMode).toBe(leafGateFailureEffectForMode);
    expect(facadeAppendScoutLifecycleEntry).toBe(leafAppendScoutLifecycleEntry);
    expect(facadeScoutDetailsFromEvent).toBe(leafScoutDetailsFromEvent);
    expect(facadeScoutStatusManager).toBe(leafScoutStatusManager);
    expect(facadeRenderScoutDetails).toBe(leafRenderScoutDetails);
    expect(facadeRegisterAdvisorTool).toBe(leafRegisterAdvisorTool);
  });

  test("keeps facade and direct state imports live after setter mutation", () => {
    const previous = facadeContextMaxCharsRef;
    const next = previous === 0 ? 1 : 0;
    try {
      facadeSetContextMaxCharsRef(next);
      expect(facadeContextMaxCharsRef).toBe(next);
      expect(leafContextMaxCharsRef).toBe(next);
      leafSetContextMaxCharsRef(previous);
      expect(facadeContextMaxCharsRef).toBe(previous);
      expect(leafContextMaxCharsRef).toBe(previous);
    } finally {
      facadeSetContextMaxCharsRef(previous);
    }
  });
});
