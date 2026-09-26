import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Fetch } from "@typesafe-ai/sdk";

import {
  advisorJevFilterEnabledRef,
  advisorJevFilterNoulMarginRef,
  advisorJevFilterOverrideWindowRef,
  advisorJevFilterSkipConfidenceRef,
  isSimpleMode,
} from "../config/state.ts";
import { JevFailure, jevClientFromCredentials } from "../jev/client.ts";
import { consumePlaintextKeyWarning } from "../jev/key-store.ts";
import {
  composeScreeningVerdict,
  screeningQuestions,
} from "../jev/questions.ts";
import { buildJevState } from "../jev/state.ts";
import { resolveJevTransport } from "../jev/transport.ts";
import type { JevCredentials } from "../jev/transport.ts";
import type { AdvisorSessionState } from "../session-state.ts";
import { createOutageNotifier } from "./outage-notifier.ts";

export type JevSkipKind = "screened" | "repeat";

export type ScreeningOutcome =
  | { decision: "allow" }
  | {
      decision: "skip";
      kind: JevSkipKind;
      reason: string;
      reattachedAdvice?: string;
    };

export interface ScreenConsultationOptions {
  draft?: string;
  force?: boolean;
  question?: string;
  signal?: AbortSignal;
}

export interface ScreeningDeps {
  fetch?: Fetch;
  resolveTransport?: () => Promise<JevCredentials | undefined>;
}

export const normalizeScreeningQuestion = (question: string | undefined) =>
  question?.trim().toLowerCase().replaceAll(/\s+/gu, " ") || undefined;

const REATTACHED_ADVICE_CAP_BYTES = 4 * 1024;

const SCREENED_SKIP_TEXT =
  "Advisor consultation skipped (screened out): the stakes are low and you can resolve this yourself with available tools and context. Proceed on your own judgment with what you already have.";

const repeatSkipText = (advice: string) =>
  `Advisor consultation skipped (already answered): this question was answered earlier in this session; the earlier advice is reattached below. Consult again only if the situation has materially changed.\n\n${advice}`;

const outageNotifier = createOutageNotifier(
  (category, message) =>
    `Advisor Jev filter failed (${category}); allowing consultations. ${message}`
);

const notifyOutageOnce = outageNotifier.notify;

/** Test-only: re-arms the once-per-outage notification. */
export const resetJevOutageNotification = outageNotifier.reset;

const allow = (): ScreeningOutcome => ({ decision: "allow" });

const bypassOutcome = (
  session: AdvisorSessionState,
  options: ScreenConsultationOptions,
  normalizedQuestion: string | undefined
): ScreeningOutcome | undefined => {
  const lastSkip = session.lastJevSkip;
  if (options.force) {
    if (
      lastSkip?.normalizedQuestion !== undefined &&
      lastSkip.normalizedQuestion === normalizedQuestion
    ) {
      session.recordJevFilterOverride();
    }
    return allow();
  }
  if (
    normalizedQuestion !== undefined &&
    lastSkip?.normalizedQuestion === normalizedQuestion &&
    session.sessionTurnOrdinal - lastSkip.turn <=
      advisorJevFilterOverrideWindowRef
  ) {
    session.recordJevFilterOverride();
    return allow();
  }
  return undefined;
};

const screenWithJev = async (
  ctx: ExtensionContext,
  session: AdvisorSessionState,
  options: ScreenConsultationOptions,
  deps: ScreeningDeps,
  normalizedQuestion: string | undefined
): Promise<ScreeningOutcome> => {
  const credentials = await (deps.resolveTransport ?? resolveJevTransport)(ctx);
  if (!credentials) {
    session.recordJevFilterFailure();
    notifyOutageOnce(
      ctx,
      "missing-key",
      "No Jev credentials resolved (no TypeSafe key and no OpenRouter login)."
    );
    return allow();
  }
  if (credentials.source === "advisor-json") {
    const warning = consumePlaintextKeyWarning();
    if (warning && ctx.hasUI) {
      ctx.ui.notify(warning, "warning");
    }
  }

  const client = jevClientFromCredentials(credentials, deps.fetch);
  try {
    const result = await client.ask(
      buildJevState(ctx, options),
      screeningQuestions,
      options.signal
    );
    session.recordJevFilterUsage(result.usage);
    const verdict = composeScreeningVerdict(result.answers, {
      noulMargin: advisorJevFilterNoulMarginRef,
      skipConfidence: advisorJevFilterSkipConfidenceRef,
    });
    if (verdict.skip) {
      session.recordJevFilterSkipped(false, normalizedQuestion);
      return {
        decision: "skip",
        kind: "screened",
        reason: "low stakes and resolvable without a consultation",
      };
    }
    session.recordJevFilterAllowed();
    return allow();
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }
    session.recordJevFilterFailure();
    if (error instanceof JevFailure) {
      notifyOutageOnce(ctx, error.category, error.message);
    } else {
      notifyOutageOnce(
        ctx,
        "error",
        error instanceof Error ? error.message : String(error)
      );
    }
    return allow();
  }
};

/**
 * Fail-open screening: decides run/skip for one ask_advisor call. Disabled or
 * simple mode, missing credentials, and every Jev failure allow the
 * consultation; only the hard conjunction (negligible-mass ≥ skip confidence
 * AND confidently self-answerable) or an exact repeat skips.
 */
export const screenConsultation = (
  ctx: ExtensionContext,
  session: AdvisorSessionState,
  options: ScreenConsultationOptions,
  deps: ScreeningDeps = {}
): Promise<ScreeningOutcome> => {
  if (isSimpleMode()) {
    return Promise.resolve(allow());
  }
  // Repeat reattachment and its force/passthrough escape hatch are code-side
  // and free: they run regardless of the Jev enable flag, which only gates
  // the (paid, network) Jev screening call.
  const normalizedQuestion = normalizeScreeningQuestion(options.question);
  const bypass = bypassOutcome(session, options, normalizedQuestion);
  if (bypass) {
    return Promise.resolve(bypass);
  }
  const reattached = session.reattachedAdviceFor(normalizedQuestion);
  if (reattached) {
    session.recordJevFilterSkipped(true, normalizedQuestion);
    return Promise.resolve({
      decision: "skip",
      kind: "repeat",
      reason: "already answered earlier in this session",
      reattachedAdvice: reattached.slice(0, REATTACHED_ADVICE_CAP_BYTES),
    });
  }
  if (!advisorJevFilterEnabledRef) {
    return Promise.resolve(allow());
  }
  return screenWithJev(ctx, session, options, deps, normalizedQuestion);
};

export const screeningSkipText = (outcome: {
  kind: JevSkipKind;
  reattachedAdvice?: string;
}) =>
  outcome.kind === "repeat" && outcome.reattachedAdvice
    ? repeatSkipText(outcome.reattachedAdvice)
    : SCREENED_SKIP_TEXT;
