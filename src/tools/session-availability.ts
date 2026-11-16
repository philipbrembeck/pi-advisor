import {
  advisorActivationRef,
  advisorToolsEnabledRef,
} from "../config/state.ts";
import type { AdvisorSessionState } from "../session-state.ts";

export const advisorToolsAllowed = (session: AdvisorSessionState) =>
  advisorActivationRef === "session"
    ? session.sessionToolsEnabled
    : advisorToolsEnabledRef;
