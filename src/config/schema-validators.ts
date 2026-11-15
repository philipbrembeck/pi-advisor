import { isString } from "../content-utils.ts";
import { normalizeJevBaseUrl } from "../jev/base-url.ts";
import {
  ADVISOR_TOOL_POLICIES,
  GATE_FAILURE_MODES,
  JEV_TRANSPORTS,
  MAX_CONTEXT_MAX_CHARS,
  MAX_SCOUT_TIMEOUT_MS,
} from "./types.ts";
import type { JevTransport } from "./types.ts";

const isNonEmptyModel = (model: unknown): model is string =>
  typeof model === "string" && model.trim().length > 0;

export const isValidAdvisorModelWhitelist = (
  value: unknown
): value is string[] => Array.isArray(value) && value.every(isNonEmptyModel);

const ADVISOR_TOOL_POLICY_NAMES = new Set<string>(ADVISOR_TOOL_POLICIES);

export const isValidAdvisorToolPolicies = (
  value: unknown
): value is Record<string, (typeof ADVISOR_TOOL_POLICIES)[number]> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([toolName, policy]) =>
      toolName.trim().length > 0 &&
      isString(policy) &&
      ADVISOR_TOOL_POLICY_NAMES.has(policy)
  );
};

export const isValidNonNegativeSafeInteger = (
  value: unknown
): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const isValidContextMaxChars = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_CONTEXT_MAX_CHARS;

export const isValidLoopThreshold = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 2;

export const isValidMaxCallsPerSession = (value: unknown): value is number =>
  isValidNonNegativeSafeInteger(value);

const GATE_FAILURE_MODE_NAMES = new Set<string>(GATE_FAILURE_MODES);

export const isValidGateFailureMode = (
  value: unknown
): value is (typeof GATE_FAILURE_MODES)[number] =>
  isString(value) && GATE_FAILURE_MODE_NAMES.has(value);

export const isValidToolResultMaxLines = (value: unknown): value is number =>
  isValidNonNegativeSafeInteger(value);

export const isValidToolResultMaxBytes = (value: unknown): value is number =>
  isValidNonNegativeSafeInteger(value);

export const isValidJevTimeoutMs = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

export const isValidScoutTimeoutMs = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 1 &&
  value <= MAX_SCOUT_TIMEOUT_MS;

export const isValidJevDigestMaxChars = (value: unknown): value is number =>
  isValidNonNegativeSafeInteger(value);

export const isValidJevPricePerMtok = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const isValidJevSkipConfidence = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0.5 &&
  value <= 1;

export const isValidJevNoulMargin = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 0.5;

const JEV_TRANSPORT_NAMES = new Set<string>(JEV_TRANSPORTS);

export const isValidJevTransport = (value: unknown): value is JevTransport =>
  isString(value) && JEV_TRANSPORT_NAMES.has(value);

/** An empty value clears the endpoint; anything else must be a usable Base URL. */
export const isValidJevBaseUrl = (value: unknown): value is string =>
  isString(value) &&
  (value.trim() === "" || normalizeJevBaseUrl(value).baseUrl !== undefined);

export const isValidJevKeyProvider = (value: unknown): value is string =>
  isString(value) && (value.trim() === "" || !/\s/u.test(value.trim()));
