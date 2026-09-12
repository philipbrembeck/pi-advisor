/** Shared Scout manifest types and transport limits. */

import type { AdvisorToolPolicies } from "./config/types.ts";

export const SCOUT_MANIFEST_MAX_BYTES = 64 * 1024;
export const SCOUT_MANIFEST_MAX_GROUPS = 64;
export const SCOUT_GROUP_MAX_BYTES = 24 * 1024;
export const SCOUT_LABEL_MAX_CHARS = 160;
export const SCOUT_SELECTION_MAX_IDS = 32;
export const SCOUT_SYNTHESIS_MAX_BYTES = 4 * 1024;

export type ScoutGroupKind =
  | "compaction"
  | "user"
  | "assistant"
  | "tool-exchange"
  | "pending-invocation";

export interface ScoutContextGroup {
  bytes: number;
  content: string;
  id: string;
  kind: ScoutGroupKind;
  label: string;
  originalIndex: number;
  required: boolean;
}

export interface ScoutManifest {
  availableBytes: number;
  availableCount: number;
  groups: ScoutContextGroup[];
  omittedBytes: number;
  omittedCount: number;
}

export type ScoutManifestResult =
  | { ok: true; manifest: ScoutManifest }
  | {
      ok: false;
      reason: "invalid-protocol" | "required-group-overflow";
      message: string;
    };

/** The invalid-protocol failure shape produced by protocol passes. */
export interface InvalidProtocolResult {
  message: string;
  ok: false;
  reason: "invalid-protocol";
}

export interface BuildScoutManifestOptions {
  currentInvocationId?: string;
  /** @deprecated Use maxManifestBytes for the Scout transport budget. */
  maxBytes?: number;
  /** Maximum reconstructed Advisor conversation characters. */
  maxConversationChars?: number;
  maxGroupBytes?: number;
  maxGroups?: number;
  /** Maximum serialized group-manifest bytes sent to Scout. */
  maxManifestBytes?: number;
  policies?: AdvisorToolPolicies;
  redact?: boolean;
  toolResultMaxBytes?: number;
  toolResultMaxLines?: number;
}
