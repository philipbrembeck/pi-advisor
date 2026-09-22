import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Narrows a mock to ExtensionContext; mocks implement only consumed members. */
// SAFETY: mock implements only the ExtensionContext subset the code under test consumes.
export const asExtensionContext = <T extends object>(
  model: T
): ExtensionContext => model as ExtensionContext;

/** Named JSON value contract for parsed fixture and response payloads. */
export type JsonValue =
  | string
  | null
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };
