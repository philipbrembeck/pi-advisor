import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  readTrackedFiles,
  readUntrackedFiles,
  type UntrackedAttachment,
} from "../attachments.ts";
import {
  advisorGitContextMaxCharsRef,
  advisorGitContextRef,
  advisorRedactSecretsRef,
  advisorScoutEnabledRef,
  advisorTrackedFileContentRef,
  advisorUntrackedContentRef,
  contextMaxCharsRef,
} from "../config/state.ts";
import {
  clampGitContextLevel,
  collectGitContext,
  type GitContextLevel,
} from "../git.ts";
import { readProjectPreferences } from "../preferences.ts";
import { redactAndCapText, redactSecrets } from "../redaction.ts";
import {
  runAdvisorScout,
  type ScoutLifecycleEvent,
  type ScoutOutcome,
} from "../scout.ts";
import { curateAdvisorConversation } from "../scout-curation.ts";
import {
  advisorGitContextBudget,
  advisorRepositoryContext,
  advisorRequestConversation,
} from "./prompts.ts";

/** Maximum bytes for project preferences and the redacted draft. */
const ATTACHMENT_TEXT_MAX_BYTES = 8 * 1024;
/** Combined budget for untracked plus tracked file attachments. */
const ATTACHMENTS_TOTAL_MAX_BYTES = 24 * 1024;

export interface ConsultationContextOptions {
  ctx: ExtensionContext;
  currentInvocationId?: string;
  draft?: string;
  gitContext?: GitContextLevel;
  includeTracked?: string[];
  includeUntracked?: string[];
  onScout?: (event: ScoutLifecycleEvent) => void;
  signal?: AbortSignal;
}

export interface ConsultationContext {
  /** Disclosed repository changes header. */
  changeText: string;
  /** Curated (or legacy) conversation body. */
  conversation: string;
  /** Redacted draft text, if a draft was supplied. */
  draftText?: string;
  /** Redacted project preferences, if present. */
  preferences?: { bytes: number; text: string };
  /** Non-cancelling Scout outcome, when Scout ran. */
  scout?: Exclude<ScoutOutcome, { cancelled: true }>;
  /** Redacted tracked-file attachments. */
  tracked: UntrackedAttachment[];
  /** Redacted untracked-file attachments. */
  untracked: UntrackedAttachment[];
}

/** Assembles every context region the Advisor request embeds: repository
 * changes (spending the shared budget first), the curated conversation,
 * project preferences, and consented file attachments. */
export const assembleConsultationContext = async (
  options: ConsultationContextOptions
): Promise<ConsultationContext> => {
  const { ctx } = options;

  // The user setting is the ceiling; the Executor may only narrow it.
  const allowed = advisorGitContextRef;
  const level = clampGitContextLevel(options.gitContext ?? allowed, allowed);
  const gitBudget = advisorGitContextBudget(
    contextMaxCharsRef,
    advisorGitContextMaxCharsRef
  );
  const changes = collectGitContext(
    ctx.cwd,
    level,
    gitBudget,
    advisorRedactSecretsRef ? redactSecrets : undefined
  );
  // The disclosure warning is control metadata, not repository payload. Keep it
  // outside the zero-byte Git budget so disabling disclosure cannot erase it.
  const changeText = advisorRepositoryContext(
    changes,
    options.gitContext ?? allowed,
    level,
    gitBudget
  );
  // Repository context spends part of the shared budget, so a large patch
  // cannot silently push the conversation past the model's context window.
  const conversationBudget = Math.max(
    0,
    contextMaxCharsRef - changeText.length
  );
  const legacyConversation = advisorRequestConversation(
    ctx,
    conversationBudget
  );
  const curated = await curateAdvisorConversation(
    ctx,
    legacyConversation,
    options.signal,
    options.onScout,
    advisorScoutEnabledRef,
    runAdvisorScout,
    options.currentInvocationId,
    conversationBudget
  );
  const preferences = await readProjectPreferences(
    ctx,
    ATTACHMENT_TEXT_MAX_BYTES,
    advisorRedactSecretsRef
  );
  const draftText = options.draft
    ? redactAndCapText(
        options.draft,
        ATTACHMENT_TEXT_MAX_BYTES,
        advisorRedactSecretsRef
      )
    : undefined;
  const untracked = await readUntrackedFiles(
    ctx.cwd,
    options.includeUntracked ?? [],
    advisorUntrackedContentRef,
    advisorRedactSecretsRef
  );
  const tracked = await readTrackedFiles(
    ctx.cwd,
    options.includeTracked ?? [],
    advisorTrackedFileContentRef,
    advisorRedactSecretsRef,
    Math.max(
      0,
      ATTACHMENTS_TOTAL_MAX_BYTES -
        untracked.reduce((sum, item) => sum + item.bytes, 0)
    )
  );
  return {
    changeText,
    conversation: curated.conversation,
    draftText,
    preferences,
    scout: curated.scout,
    tracked,
    untracked,
  };
};
