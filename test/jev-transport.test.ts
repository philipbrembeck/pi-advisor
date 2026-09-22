import { afterEach, describe, expect, test } from "bun:test";

import { setAdvisorJevTransportRef } from "../src/config/state.ts";
import { resolveJevTransport } from "../src/jev/transport.ts";

afterEach(() => {
  setAdvisorJevTransportRef("auto");
});

const noKey = () => Promise.resolve({});
const typesafeKey = () =>
  Promise.resolve({ key: "typesafe-key", source: "env" as const });

const providerKeys =
  (keys: Record<string, string>) => async (provider: string) =>
    keys[provider];

describe("resolveJevTransport", () => {
  test("auto prefers a dedicated TypeSafe key over the OpenRouter login", async () => {
    setAdvisorJevTransportRef("auto");
    const credentials = await resolveJevTransport(undefined, {
      getProviderKey: providerKeys({ openrouter: "openrouter-key" }),
      resolveTypesafe: typesafeKey,
    });
    expect(credentials).toEqual({
      apiKey: "typesafe-key",
      source: "env",
      transport: "typesafe",
    });
  });

  test("auto reuses the pi OpenRouter login when no TypeSafe key exists", async () => {
    setAdvisorJevTransportRef("auto");
    const credentials = await resolveJevTransport(undefined, {
      getProviderKey: providerKeys({ openrouter: "openrouter-key" }),
      resolveTypesafe: noKey,
    });
    expect(credentials).toEqual({
      apiKey: "openrouter-key",
      transport: "openrouter",
    });
  });

  test("openrouter skips the TypeSafe chain entirely", async () => {
    setAdvisorJevTransportRef("openrouter");
    const credentials = await resolveJevTransport(undefined, {
      getProviderKey: providerKeys({ openrouter: "openrouter-key" }),
      resolveTypesafe: typesafeKey,
    });
    expect(credentials).toEqual({
      apiKey: "openrouter-key",
      transport: "openrouter",
    });
  });

  test("typesafe never falls back to OpenRouter", async () => {
    setAdvisorJevTransportRef("typesafe");
    const credentials = await resolveJevTransport(undefined, {
      getProviderKey: providerKeys({ openrouter: "openrouter-key" }),
      resolveTypesafe: noKey,
    });
    expect(credentials).toBeUndefined();
  });

  test("resolves nothing when neither source has a key", async () => {
    const credentials = await resolveJevTransport(undefined, {
      getProviderKey: providerKeys({}),
      resolveTypesafe: noKey,
    });
    expect(credentials).toBeUndefined();
  });

  test("ignores a blank OpenRouter login", async () => {
    const credentials = await resolveJevTransport(undefined, {
      getProviderKey: providerKeys({ openrouter: "  \n" }),
      resolveTypesafe: noKey,
    });
    expect(credentials).toBeUndefined();
  });
});
