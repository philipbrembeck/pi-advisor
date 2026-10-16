import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  advisorJevClassifierModeRef,
  advisorJevClassifierRef,
  advisorJevFilterEnabledRef,
  advisorJevFilterNoulMarginRef,
  advisorJevFilterOverrideWindowRef,
  advisorJevFilterSkipConfidenceRef,
  isSimpleMode,
} from "../config/state.ts";
import { capUtf8Bytes } from "../content-utils.ts";
import { consumeJevClassifierKey } from "../jev/classifier-key-store.ts";
import { classifyScreening } from "../jev/classifier.ts";
import { JevFailure } from "../jev/failure.ts";
import { composeScreeningVerdict } from "../jev/questions.ts";
import { buildJevState } from "../jev/state.ts";
import type { AdvisorSessionState } from "../session-state.ts";
import { createOutageNotifier } from "./outage-notifier.ts";

export type JevSkipKind = "screened" | "repeat";

export type ScreeningOutcome =
  | { decision: "allow"; usage?: Usage }
  | {
      decision: "skip";
      kind: JevSkipKind;
      reason: string;
      reattachedAdvice?: string;
      usage?: Usage;
    };

export interface ScreenConsultationOptions {
  draft?: string;
  force?: boolean;
  question?: string;
  signal?: AbortSignal;
}

export interface ScreeningDeps {
  classify?: typeof classifyScreening;
  classifyResult?: (
    state: ReturnType<typeof buildJevState>,
    signal?: AbortSignal
  ) => Promise<
    ReturnType<typeof classifyScreening> extends Promise<infer Result>
      ? Result
      : never
  >;
  resolveApiKey?: () => Promise<string | undefined>;
  selectedRef?: () => string | undefined;
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
    `Advisor Jev classifier failed (${category}); allowing consultations. ${message}`
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

const classifierRef = (deps: ScreeningDeps) =>
  advisorJevClassifierModeRef === "api-key"
    ? "typesafe/jev-latest"
    : (deps.selectedRef?.() ?? advisorJevClassifierRef);

const apiKeyFor = (deps: ScreeningDeps) =>
  advisorJevClassifierModeRef === "api-key"
    ? (deps.resolveApiKey ?? consumeJevClassifierKey)()
    : Promise.resolve(undefined);

const screenWithJev = async (
  ctx: ExtensionContext,
  session: AdvisorSessionState,
  options: ScreenConsultationOptions,
  deps: ScreeningDeps,
  normalizedQuestion: string | undefined
): Promise<ScreeningOutcome> => {
  const selectedRef = classifierRef(deps);
  const apiKey = await apiKeyFor(deps);

  if (!selectedRef || (advisorJevClassifierModeRef === "api-key" && !apiKey)) {
    session.recordJevFilterFailure();
    notifyOutageOnce(
      ctx,
      "missing-key",
      "No credentials resolved for the selected Jev classifier."
    );

    return allow();
  }

  try {
    const state = buildJevState(ctx, options);

    const result = deps.classifyResult
      ? await deps.classifyResult(state, options.signal)
      : await (deps.classify ?? classifyScreening)(ctx, selectedRef, state, {
          apiKey:
            advisorJevClassifierModeRef === "api-key" ? apiKey : undefined,
          signal: options.signal,
        });

    if (result.usage) {
      session.recordJevFilterUsage({
        cost: result.usage.cost,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
    }

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
        usage: result.usage?.piUsage,
      };
    }

    session.recordJevFilterAllowed();

    return { decision: "allow", usage: result.usage?.piUsage };
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
      reattachedAdvice: capUtf8Bytes(reattached, REATTACHED_ADVICE_CAP_BYTES),
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
