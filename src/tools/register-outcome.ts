import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { advisorOutcomeLoggingRef } from "../config/state.js";
import { loadConfig } from "../config/storage.js";
import { textFrom } from "../conversation.js";
import { ADOPTIONS, VALIDATIONS } from "../outcomes.js";
import type { ToolRegistrationContext } from "./types.js";

export const registerOutcomeTool = ({
  appendOutcome: appendAdvisorOutcome,
  pi,
  session,
}: ToolRegistrationContext): void => {
  pi.registerTool({
    description:
      "Voluntarily record the settled adoption and validation outcome for a displayed adviceId when global outcome logging is enabled.",
    async execute(_id, params, _signal, _update, ctx) {
      loadConfig(ctx);
      if (!advisorOutcomeLoggingRef) {
        return {
          content: [
            { text: "Outcome logging is disabled globally.", type: "text" },
          ],
          details: { recorded: false },
        };
      }
      const advice = session.reserveAdvice(params.adviceId);
      if (!advice) {
        throw new Error("Unknown, already recorded, or pending adviceId.");
      }
      try {
        await appendAdvisorOutcome({
          adoption: params.adoption as (typeof ADOPTIONS)[number],
          advice: advice.advice,
          trigger: advice.trigger,
          validationStatus:
            params.validationStatus as (typeof VALIDATIONS)[number],
        });
        session.commitAdvice(params.adviceId);
        return {
          content: [
            { text: "Advisor outcome recorded locally.", type: "text" },
          ],
          details: { recorded: true },
        };
      } catch {
        session.releaseAdvice(params.adviceId);
        if (ctx.hasUI) {
          ctx.ui.notify(
            "Advisor outcome could not be recorded locally.",
            "warning"
          );
        }
        return {
          content: [
            {
              text: "Advisor outcome was not recorded; Advisor execution remains usable.",
              type: "text",
            },
          ],
          details: { recorded: false },
        };
      }
    },
    label: "Record Advisor Outcome",
    name: "record_advisor_outcome",
    parameters: Type.Object({
      adoption: Type.String({ enum: ADOPTIONS }),
      adviceId: Type.String(),
      validationStatus: Type.String({ enum: VALIDATIONS }),
    }),
    renderCall: () => new Text("[advisor] Record outcome", 0, 0),
    renderResult: (result) => new Text(textFrom(result.content), 0, 0),
  });
};
