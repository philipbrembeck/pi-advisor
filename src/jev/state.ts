import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JsonValue } from "@typesafe-ai/sdk";

import {
  advisorJevDigestMaxCharsRef,
  advisorRedactSecretsRef,
} from "../config/state.ts";
import { recentConversation } from "../conversation.ts";
import { redactAndCapText } from "../redaction.ts";

/** Per-field byte cap for executor question and draft sent to Jev. */
export const JEV_TEXT_CAP_BYTES = 8 * 1024;

export interface JevStateInput {
  draft?: string;
  question?: string;
}

export type JevState = Record<string, JsonValue>;

/** Builds the Jev screening state: named fields, redacted and capped through
 * the existing egress pipeline, with the conversation digest as fallback
 * evidence when no explicit request exists. */
export const buildJevState = (
  ctx: ExtensionContext,
  input: JevStateInput = {}
) => {
  const fields = new Map<string, string>([["role", "executor"]]);
  if (input.question) {
    fields.set(
      "executor_question",
      redactAndCapText(
        input.question,
        JEV_TEXT_CAP_BYTES,
        advisorRedactSecretsRef
      )
    );
  }
  if (input.draft) {
    fields.set(
      "executor_draft",
      redactAndCapText(input.draft, JEV_TEXT_CAP_BYTES, advisorRedactSecretsRef)
    );
  }
  const digest = recentConversation(ctx, advisorJevDigestMaxCharsRef);
  if (digest) {
    fields.set("recent_conversation", digest);
  }
  return Object.fromEntries(fields);
};
