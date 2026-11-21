import { randomUUID } from "node:crypto";

import type { ImageContent } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { readTrackedFiles, readUntrackedFiles } from "../attachments.ts";
import type { UntrackedAttachment } from "../attachments.ts";
import {
  advisorAgentsMdContextRef,
  advisorGitContextMaxCharsRef,
  advisorGitContextRef,
  advisorRedactSecretsRef,
  advisorScoutEnabledRef,
  advisorToolPoliciesRef,
  advisorTrackedFileContentRef,
  advisorUntrackedContentRef,
  contextMaxCharsRef,
} from "../config/state.ts";
import { clampGitContextLevel, collectGitContext } from "../git.ts";
import type { GitContextLevel } from "../git.ts";
import { readImageFiles } from "../image-attachments.ts";
import {
  ADVISOR_IMAGES_MAX_COUNT,
  ADVISOR_IMAGES_TOTAL_MAX_BYTES,
  selectedConversationImages,
} from "../images.ts";
import { readProjectPreferences, readProjectRules } from "../preferences.ts";
import { redactAndCapText, redactSecrets } from "../redaction.ts";
import { curateAdvisorConversation } from "../scout-curation.ts";
import { runAdvisorScout } from "../scout.ts";
import type { ScoutLifecycleEvent, ScoutOutcome } from "../scout.ts";
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
  supportsImages?: boolean;
}

export interface ConsultationContext {
  /** Disclosed repository changes header. */
  changeText: string;
  /** Curated (or legacy) conversation body. */
  conversation: string;
  /** Redacted draft text, if a draft was supplied. */
  draftText?: string;
  imageOmissions: number;
  imagePartsSeen: number;
  images: { image: ImageContent; label: string }[];
  supportsImages: boolean;
  /** Redacted project preferences, if present. */
  preferences?: { bytes: number; text: string };
  /** Redacted trusted AGENTS.md files, or a withheld-project note. */
  projectRules?: Awaited<ReturnType<typeof readProjectRules>>;
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

  const changes = await collectGitContext(
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

  const imageNonce = randomUUID();

  const legacyConversation = advisorRequestConversation(
    ctx,
    conversationBudget,
    true,
    imageNonce
  );

  const curated = await curateAdvisorConversation(
    ctx,
    legacyConversation,
    options.signal,
    options.onScout,
    advisorScoutEnabledRef,
    runAdvisorScout,
    options.currentInvocationId,
    conversationBudget,
    imageNonce
  );

  const preferences = await readProjectPreferences(
    ctx,
    ATTACHMENT_TEXT_MAX_BYTES,
    advisorRedactSecretsRef
  );

  const projectRules = advisorAgentsMdContextRef
    ? await readProjectRules(
        ctx,
        ATTACHMENT_TEXT_MAX_BYTES,
        advisorRedactSecretsRef
      )
    : undefined;

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

  const supportsImages = options.supportsImages ?? false;

  const untrackedImages = await readImageFiles(
    ctx.cwd,
    options.includeUntracked ?? [],
    supportsImages && advisorUntrackedContentRef,
    "untracked",
    ADVISOR_IMAGES_TOTAL_MAX_BYTES,
    ADVISOR_IMAGES_MAX_COUNT
  );

  const trackedImages = await readImageFiles(
    ctx.cwd,
    options.includeTracked ?? [],
    supportsImages && advisorTrackedFileContentRef,
    "tracked",
    ADVISOR_IMAGES_TOTAL_MAX_BYTES -
      untrackedImages.images.reduce((sum, item) => sum + item.bytes, 0),
    ADVISOR_IMAGES_MAX_COUNT - untrackedImages.images.length
  );

  const images = [...untrackedImages.images, ...trackedImages.images].map(
    (item) => ({
      image: item.image,
      label: `File ${JSON.stringify(item.path)}`,
    })
  );

  let remainingBytes =
    ADVISOR_IMAGES_TOTAL_MAX_BYTES -
    [...untrackedImages.images, ...trackedImages.images].reduce(
      (sum, item) => sum + item.bytes,
      0
    );

  let imageOmissions = untrackedImages.omitted + trackedImages.omitted;

  const census = selectedConversationImages(
    ctx,
    curated.conversation,
    advisorToolPoliciesRef,
    curated.scout?.ok === true
      ? new Set<string>(curated.selectedEntryIds)
      : undefined,
    imageNonce
  );

  for (const item of census.selected) {
    const bytes = Buffer.from(item.image.data, "base64").length;

    if (
      !supportsImages ||
      images.length >= ADVISOR_IMAGES_MAX_COUNT ||
      bytes > remainingBytes
    ) {
      imageOmissions += 1;
      continue;
    }

    remainingBytes -= bytes;
    images.push({ image: item.image, label: item.marker });
  }

  return {
    changeText,
    conversation: curated.conversation,
    draftText,
    imageOmissions,
    imagePartsSeen: census.imagePartsSeen,
    images,
    preferences,
    projectRules,
    scout: curated.scout,
    supportsImages,
    tracked,
    untracked,
  };
};
