import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  advisorRedactSecretsRef,
  advisorToolPoliciesRef,
  advisorToolResultMaxBytesRef,
  advisorToolResultMaxLinesRef,
} from "./config/state.ts";
import {
  buildGroups,
  type DisclosureCaps,
  type GroupPass,
  groupWireBytes,
} from "./scout-groups.ts";
import { indexToolCalls } from "./scout-protocol.ts";
import {
  type BuildScoutManifestOptions,
  SCOUT_GROUP_MAX_BYTES,
  SCOUT_MANIFEST_MAX_BYTES,
  SCOUT_MANIFEST_MAX_GROUPS,
  type ScoutContextGroup,
  type ScoutManifestResult,
} from "./scout-types.ts";

// biome-ignore lint/performance/noBarrelFile: re-export preserves scout-context's historical public import surface.
export { reconstructScoutConversation } from "./scout-reconstruct.ts";
export type {
  BuildScoutManifestOptions,
  ScoutManifest,
  ScoutManifestResult,
} from "./scout-types.ts";

export { SCOUT_MANIFEST_MAX_BYTES } from "./scout-types.ts";

const resolveCaps = (
  options: BuildScoutManifestOptions
): DisclosureCaps & {
  maxConversationChars?: number;
  maxGroupBytes: number;
  maxGroups: number;
  maxManifestBytes: number;
} => ({
  currentInvocationId: options.currentInvocationId,
  maxConversationChars: options.maxConversationChars,
  maxGroupBytes: options.maxGroupBytes ?? SCOUT_GROUP_MAX_BYTES,
  maxGroups: options.maxGroups ?? SCOUT_MANIFEST_MAX_GROUPS,
  maxManifestBytes:
    options.maxManifestBytes ?? options.maxBytes ?? SCOUT_MANIFEST_MAX_BYTES,
  policies: options.policies ?? advisorToolPoliciesRef,
  redact: options.redact ?? advisorRedactSecretsRef,
  toolResultMaxBytes:
    options.toolResultMaxBytes ?? advisorToolResultMaxBytesRef,
  toolResultMaxLines:
    options.toolResultMaxLines ?? advisorToolResultMaxLinesRef,
});

/** Builds disclosed, indivisible history groups from Pi's compaction-aware branch. */
export const buildScoutManifest = (
  ctx: ExtensionContext,
  options: BuildScoutManifestOptions = {}
): ScoutManifestResult => {
  const entries = ctx.sessionManager.buildContextEntries();
  const caps = resolveCaps(options);
  const indexed = indexToolCalls(entries);
  if (!indexed.ok) {
    return indexed;
  }
  const built = buildGroups(entries, indexed.index, caps);
  if (!built.ok) {
    return built;
  }
  return fitToBudget(built, caps);
};

const fits = (
  selected: ScoutContextGroup[],
  caps: {
    maxConversationChars?: number;
    maxGroupBytes: number;
    maxGroups: number;
    maxManifestBytes: number;
  }
) =>
  selected.length <= caps.maxGroups &&
  selected.reduce((sum, group) => sum + groupWireBytes(group), 0) <=
    caps.maxManifestBytes &&
  (caps.maxConversationChars === undefined ||
    contentChars(selected) <= caps.maxConversationChars);

const contentChars = (items: ScoutContextGroup[]) =>
  items.reduce((sum, group) => sum + group.content.length, 0) +
  Math.max(0, items.length - 1) * 2;

const fitToBudget = (
  built: GroupPass,
  caps: {
    maxConversationChars?: number;
    maxGroupBytes: number;
    maxGroups: number;
    maxManifestBytes: number;
  }
): ScoutManifestResult => {
  const { groups, protocolOmittedBytes, protocolOmittedCount } = built;
  const availableCount = groups.length + protocolOmittedCount;
  const availableBytes =
    groups.reduce((sum, group) => sum + groupWireBytes(group), 0) +
    protocolOmittedBytes;
  if (caps.maxManifestBytes <= 0) {
    return {
      manifest: {
        availableBytes: 0,
        availableCount: 0,
        groups: [],
        omittedBytes: 0,
        omittedCount: 0,
      },
      ok: true,
    };
  }
  const required = groups.filter((group) => group.required);
  const overflow = requiredOverflow(required, caps);
  if (overflow) {
    return overflow;
  }
  const selected = groups.filter(
    (group) => group.required || group.bytes <= caps.maxGroupBytes
  );
  while (!fits(selected, caps)) {
    const optionalIndex = selected.findIndex((group) => !group.required);
    if (optionalIndex < 0) {
      return {
        message: "Required Scout context exceeds fixed manifest limits.",
        ok: false,
        reason: "required-group-overflow",
      };
    }
    selected.splice(optionalIndex, 1);
  }
  const selectedIds = new Set(selected.map((group) => group.id));
  const omitted = groups.filter((group) => !selectedIds.has(group.id));
  return {
    manifest: {
      availableBytes,
      availableCount,
      groups: selected,
      omittedBytes:
        protocolOmittedBytes +
        omitted.reduce((sum, group) => sum + group.bytes, 0),
      omittedCount: protocolOmittedCount + omitted.length,
    },
    ok: true,
  };
};

const requiredOverflow = (
  required: ScoutContextGroup[],
  caps: {
    maxConversationChars?: number;
    maxGroupBytes: number;
    maxGroups: number;
    maxManifestBytes: number;
  }
): ScoutManifestResult | undefined => {
  if (
    required.some((group) => group.bytes > caps.maxGroupBytes) ||
    required.length > caps.maxGroups ||
    required.reduce((sum, group) => sum + groupWireBytes(group), 0) >
      caps.maxManifestBytes
  ) {
    return {
      message:
        "Required Scout context exceeds the Scout manifest transport limit.",
      ok: false,
      reason: "required-group-overflow",
    };
  }
  if (
    caps.maxConversationChars !== undefined &&
    contentChars(required) > caps.maxConversationChars
  ) {
    return {
      message:
        "Required Scout context exceeds the Advisor conversation budget.",
      ok: false,
      reason: "required-group-overflow",
    };
  }
  return undefined;
};
