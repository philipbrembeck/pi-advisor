import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { redactSecrets } from "../../../src/redaction.ts";
import { replayCaseFor } from "../gates.ts";
import type { ReplayFixture } from "../types.ts";
import type { CapturedRequest } from "./mock-provider.ts";

export const DEFAULT_VOLATILE_FIELDS = ["timestamp"] as const;

const redactValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactValue(child)])
    );
  }
  return value;
};

/** Converts a provider capture into a safe, checked-in replay payload. */
export const replayFixtureFromCapture = (
  capture: CapturedRequest,
  id: string,
  response: string,
  volatileFields: string[] = [...DEFAULT_VOLATILE_FIELDS]
): ReplayFixture => {
  const replayCase = replayCaseFor(response);
  const expected =
    replayCase === "malformed" ||
    replayCase === "duplicated" ||
    replayCase === "contradictory"
      ? "failure"
      : replayCase;
  return {
    gate: {
      case: replayCase,
      expected,
      failureMode: "block-session",
      response,
    },
    id,
    payload: redactValue(capture.body) as Record<string, unknown>,
    volatileFields: [...volatileFields],
  };
};

export const writeReplayFixture = (path: string, fixture: ReplayFixture) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  return path;
};

export const captureForReplay = (
  capture: CapturedRequest,
  id: string,
  response: string
) => replayFixtureFromCapture(capture, id, response);
