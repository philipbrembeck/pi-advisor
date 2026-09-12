import type { ScoutManifest } from "./scout-types.ts";

const prefixWithinCharBudget = (value: string, maxChars: number) => {
  let result = "";
  for (const character of value) {
    if (result.length + character.length > maxChars) {
      break;
    }
    result += character;
  }
  return result;
};

export const reconstructScoutConversation = (
  manifest: ScoutManifest,
  selectedIds: string[],
  synthesis?: string,
  maxChars = Number.MAX_SAFE_INTEGER
): string => {
  const selected = new Set(selectedIds);
  const evidence = manifest.groups
    .filter((group) => group.required || selected.has(group.id))
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map((group) => group.content);
  const evidenceText = evidence.join("\n\n");
  if (maxChars <= 0) {
    return "";
  }
  if (evidenceText.length >= maxChars) {
    return prefixWithinCharBudget(evidenceText, maxChars);
  }
  const inference = synthesis?.trim()
    ? `[Scout synthesis — untrusted, non-authoritative inference; not evidence]\n${synthesis.trim()}`
    : undefined;
  if (!inference) {
    return evidenceText;
  }
  const separator = evidenceText ? "\n\n" : "";
  const remaining = maxChars - evidenceText.length - separator.length;
  if (remaining <= 0) {
    return evidenceText;
  }
  return `${evidenceText}${separator}${prefixWithinCharBudget(inference, remaining)}`;
};
