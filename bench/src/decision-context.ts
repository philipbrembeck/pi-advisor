import { readFileSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets } from "../../src/redaction.ts";
import type { DecisionItem } from "./types.ts";

const region = (name: string, value: string) =>
  `<${name}>\n${value}\n</${name}>`;

/**
 * Builds only the material the Advisor is allowed to see. Answer keys and
 * traps are intentionally not read here; the judge is the sole consumer of
 * those files.
 */
export const advisorContextForItem = (
  item: DecisionItem,
  redact = true
): string => {
  const conversation = redact
    ? redactSecrets(item.conversation)
    : item.conversation;
  const draft = redact ? redactSecrets(item.draft) : item.draft;
  const repoNote = `Repository fixture available at ${item.repoPath}; inspect only the supplied evidence.`;
  return [
    region("conversation", conversation),
    region("draft", draft),
    repoNote,
  ].join("\n\n");
};

/** A cheap assertion that a serialized Advisor payload contains no scorer key. */
export const assertAdvisorPayloadExcludesKey = (
  item: DecisionItem,
  payload: unknown
) => {
  const serialized = JSON.stringify(payload);
  const forbidden = [
    "key/answer.toml",
    "key/traps.toml",
    "/key/answer.toml",
    "/key/traps.toml",
  ];
  const leaks = forbidden.filter((value) => serialized.includes(value));
  if (leaks.length > 0) {
    throw new Error(
      `Decision item ${item.id} leaked scorer key data: ${leaks.join(", ")}`
    );
  }
  return true;
};

/** Loads only the public draft/conversation/repo descriptor for auditing. */
export const publicDecisionFixture = (directory: string) => ({
  conversation: JSON.parse(
    readFileSync(join(directory, "conversation.json"), "utf8")
  ) as unknown,
  draft: readFileSync(join(directory, "draft.md"), "utf8"),
  repoPath: join(directory, "repo"),
});
