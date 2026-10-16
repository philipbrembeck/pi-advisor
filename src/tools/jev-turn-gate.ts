import type {
  ExtensionContext,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

import {
  advisorJevClassifierModeRef,
  advisorJevClassifierRef,
  advisorJevTurnGateEveryTurnsRef,
  advisorJevTurnGateNoulThresholdRef,
  getAdvisorMaxCallsPerSession,
  isSimpleMode,
} from "../config/state.ts";
import { herdrAdvisorActivity } from "../herdr.ts";
import type { HerdrAdvisorActivityScope } from "../herdr.ts";
import { consumeJevClassifierKey } from "../jev/classifier-key-store.ts";
import { classifyTurnGate } from "../jev/classifier.ts";
import { JevFailure } from "../jev/failure.ts";
import { composeTurnGateVerdict } from "../jev/questions.ts";
import { buildJevState } from "../jev/state.ts";
import type { AdvisorSessionState } from "../session-state.ts";
import { advisorUsageCost } from "../usage.ts";
import type { consultAdvisor } from "./consultation.ts";
import { updateAdvisorUsageStatus } from "./gate-policy.ts";
import { advisorModelIsAllowed } from "./model-access.ts";
import { createOutageNotifier } from "./outage-notifier.ts";

export interface JevTurnGateDeps {
  classifyResult?: () => ReturnType<typeof classifyTurnGate>;
  consult?: typeof consultAdvisor;
  resolveApiKey?: () => Promise<string | undefined>;
  selectedRef?: () => string | undefined;
}

export interface TurnGateCallDetails {
  question: string;
  turn: number;
}

export interface TurnGateResultDetails {
  advisor: string;
  agentRulesBytes?: number;
  text: string;
  usage?: unknown;
}

export interface JevTurnGateRegistration {
  activeTools: () => string[];
  consult: typeof consultAdvisor;
  deps?: JevTurnGateDeps;
  herdrActivity?: HerdrAdvisorActivityScope;
  send: (message: {
    content: string;
    customType: string;
    details: TurnGateCallDetails | TurnGateResultDetails;
    display: boolean;
  }) => void;
  session: AdvisorSessionState;
}

const outageNotifier = createOutageNotifier(
  (category, message) =>
    `Advisor Jev classifier turn gate failed (${category}); continuing without a proactive consultation. ${message}`
);

const notifyFailureOnce = outageNotifier.notify;

const shouldRunTurnGate = (
  registration: JevTurnGateRegistration,
  ctx: ExtensionContext,
  session: AdvisorSessionState
) => {
  const interval = advisorJevTurnGateEveryTurnsRef;

  return (
    interval > 0 &&
    session.turnsSinceConsultation > 0 &&
    session.turnsSinceConsultation % interval === 0 &&
    !isSimpleMode() &&
    !session.blocked &&
    registration.activeTools().includes("ask_advisor") &&
    advisorModelIsAllowed(ctx) &&
    session.canConsult(getAdvisorMaxCallsPerSession())
  );
};

const consumeTurnGateBudget = (
  session: AdvisorSessionState,
  shouldConsult: boolean
) => {
  if (!shouldConsult || !session.canConsult(getAdvisorMaxCallsPerSession())) {
    return false;
  }

  session.consumeCall();

  return true;
};

/** Test-only: re-arms the once-per-outage notification. */
export const resetJevTurnGateNotification = outageNotifier.reset;

const classifyGate = async (ctx: ExtensionContext, deps: JevTurnGateDeps) => {
  if (deps.classifyResult) {
    return deps.classifyResult();
  }

  const selectedRef =
    advisorJevClassifierModeRef === "api-key"
      ? "typesafe/jev-latest"
      : (deps.selectedRef?.() ?? advisorJevClassifierRef);

  const apiKey =
    advisorJevClassifierModeRef === "api-key"
      ? await (deps.resolveApiKey ?? consumeJevClassifierKey)()
      : undefined;

  if (!selectedRef || (advisorJevClassifierModeRef === "api-key" && !apiKey)) {
    throw new JevFailure(
      "auth",
      "No credentials resolved for the selected Jev classifier."
    );
  }

  return classifyTurnGate(ctx, selectedRef, buildJevState(ctx, {}), {
    apiKey,
    signal: ctx.signal,
  });
};

const sendProactiveConsultation = async (
  registration: JevTurnGateRegistration,
  ctx: ExtensionContext,
  consult: typeof consultAdvisor
) => {
  const { session } = registration;
  const activity = registration.herdrActivity ?? herdrAdvisorActivity;
  const finishHerdrActivity = activity.start();

  try {
    registration.send({
      content: "Proactive Advisor turn review",
      customType: "advisor-turn-gate-call",
      details: {
        question: `Turn gate: ${session.turnsSinceConsultation} turns without a consultation`,
        turn: session.sessionTurnOrdinal,
      },
      display: true,
    });

    const consulted = await consult(
      ctx,
      undefined,
      ctx.signal,
      undefined,
      "turn-gate"
    );

    session.recordJevGateConsultation();
    session.resetTurnsSinceConsultation();
    session.recordInvocation({
      cost: advisorUsageCost(consulted.usage),
      executionEffect: "continued",
      kind: "markdown",
      model: consulted.model,
      trigger: "turn-gate",
      usage: consulted.usage,
    });
    updateAdvisorUsageStatus(ctx, session);
    registration.send({
      content: consulted.markdown,
      customType: "advisor-turn-gate-result",
      details: {
        advisor: consulted.model,
        agentRulesBytes: consulted.agentRulesBytes,
        text: consulted.markdown,
        usage: consulted.usage,
      },
      display: true,
    });
  } finally {
    finishHerdrActivity();
  }
};

/** Run the periodic policy check and optional proactive consultation. */
export const handleJevTurnEnd = async (
  registration: JevTurnGateRegistration,
  ctx: ExtensionContext
): Promise<void> => {
  const { session } = registration;
  session.recordCompletedTurn();

  if (!shouldRunTurnGate(registration, ctx, session)) {
    return;
  }

  const consult = registration.deps?.consult ?? registration.consult;

  try {
    const result = await classifyGate(ctx, registration.deps ?? {});
    session.recordJevGateCheck(
      result.usage
        ? {
            cost: result.usage.cost,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          }
        : undefined
    );

    const shouldConsult = composeTurnGateVerdict(
      result.answers,
      advisorJevTurnGateNoulThresholdRef
    );

    if (
      advisorModelIsAllowed(ctx) &&
      consumeTurnGateBudget(session, shouldConsult)
    ) {
      await sendProactiveConsultation(registration, ctx, consult);
    }
  } catch (error) {
    session.recordJevGateFailure();

    if (error instanceof JevFailure) {
      notifyFailureOnce(ctx, error.category, error.message);
    } else if (!ctx.signal?.aborted) {
      notifyFailureOnce(
        ctx,
        "error",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
};

type TurnEndRegistrar = (
  event: "turn_end",
  handler: (event: TurnEndEvent, ctx: ExtensionContext) => void | Promise<void>
) => void;

/** Wires the turn_end handler on an ExtensionAPI-like surface. */
export const registerJevTurnGate = (
  on: TurnEndRegistrar,
  registration: JevTurnGateRegistration
): void => {
  on("turn_end", (_event, ctx) => handleJevTurnEnd(registration, ctx));
};
