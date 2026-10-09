import { afterEach, describe, expect, test } from "bun:test";

import {
  setAdvisorJevBaseUrlRef,
  setAdvisorJevKeyProviderRef,
  setAdvisorJevTransportRef,
} from "../src/config/state.ts";
import { resolveJevTransport } from "../src/jev/transport.ts";

afterEach(() => {
  setAdvisorJevTransportRef("auto");
  setAdvisorJevBaseUrlRef(undefined);
  setAdvisorJevKeyProviderRef(undefined);
});

const noKey = () => Promise.resolve({});
const typesafeKey = () =>
  Promise.resolve({ key: "typesafe-key", source: "env" as const });

const providerKeys =
  (keys: Record<string, string>) => async (provider: string) =>
    keys[provider];

const endpointDeps = (key: string | undefined) => ({
  resolveEndpointKey: () =>
    Promise.resolve(key ? { key, source: "jev-env" as const } : {}),
});

describe("typesafe-compatible endpoint", () => {
  test("resolves the dedicated endpoint key against the normalized Base URL", async () => {
    setAdvisorJevTransportRef("typesafe-compatible");
    setAdvisorJevBaseUrlRef("https://gw.corp/llm/jev/v1");
    const credentials = await resolveJevTransport(
      undefined,
      endpointDeps("jv_live_key")
    );
    expect(credentials).toEqual({
      apiKey: "jv_live_key",
      baseUrl: "https://gw.corp/llm/jev",
      source: "jev-env",
      transport: "typesafe-compatible",
    });
  });

  test("prefers a named Pi provider login over the dedicated key store", async () => {
    setAdvisorJevTransportRef("typesafe-compatible");
    setAdvisorJevBaseUrlRef("https://api.codiv.ai");
    setAdvisorJevKeyProviderRef("vercel");
    const lookups: string[] = [];
    const credentials = await resolveJevTransport(undefined, {
      getProviderKey: async (provider) => {
        lookups.push(provider);
        return "pi-stored-key";
      },
      resolveEndpointKey: async () => {
        lookups.push("endpoint-store");
        return { key: "jv_live_key", source: "jev-env" };
      },
    });
    expect(credentials).toEqual({
      apiKey: "pi-stored-key",
      baseUrl: "https://api.codiv.ai",
      source: "provider-credential",
      transport: "typesafe-compatible",
    });
    expect(lookups).toEqual(["vercel"]);
  });

  test("a declared Pi provider login never falls back to the stored endpoint key", async () => {
    setAdvisorJevTransportRef("typesafe-compatible");
    setAdvisorJevBaseUrlRef("https://api.codiv.ai");
    setAdvisorJevKeyProviderRef("vercel");
    const credentials = await resolveJevTransport(undefined, {
      getProviderKey: async () => undefined,
      resolveEndpointKey: async () => ({
        key: "stale-key",
        source: "jev-env",
      }),
    });
    expect(credentials).toBeUndefined();
  });

  test("resolves nothing without a configured Base URL", async () => {
    setAdvisorJevTransportRef("typesafe-compatible");
    setAdvisorJevBaseUrlRef(undefined);
    const credentials = await resolveJevTransport(
      undefined,
      endpointDeps("jv_live_key")
    );
    expect(credentials).toBeUndefined();
  });

  test("resolves nothing when the configured Base URL is unusable", async () => {
    setAdvisorJevTransportRef("typesafe-compatible");
    setAdvisorJevBaseUrlRef("http://jev.example.com");
    const credentials = await resolveJevTransport(
      undefined,
      endpointDeps("jv_live_key")
    );
    expect(credentials).toBeUndefined();
  });

  test("resolves nothing when no endpoint key is available", async () => {
    setAdvisorJevTransportRef("typesafe-compatible");
    setAdvisorJevBaseUrlRef("https://api.codiv.ai");
    const credentials = await resolveJevTransport(
      undefined,
      endpointDeps(undefined)
    );
    expect(credentials).toBeUndefined();
  });

  test("auto never selects the endpoint even when it is fully configured", async () => {
    setAdvisorJevTransportRef("auto");
    setAdvisorJevBaseUrlRef("https://api.codiv.ai");
    const credentials = await resolveJevTransport(undefined, {
      getProviderKey: async () => undefined,
      resolveEndpointKey: () => Promise.reject(new Error("must not be read")),
      resolveTypesafe: noKey,
    });
    expect(credentials).toBeUndefined();
  });
});

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

  test("explicit OpenAI Decisions accepts only known Platform API-key sources", async () => {
    setAdvisorJevTransportRef("openai-decisions");
    const allowedSources: [
      string,
      "openai-env" | "openai-provider-credential",
    ][] = [
      ["OPENAI_API_KEY", "openai-env"],
      ["stored credential", "openai-provider-credential"],
    ];
    for (const [source, expectedSource] of allowedSources) {
      const lookups: string[] = [];
      const credentials = await resolveJevTransport(undefined, {
        getProviderAuth: async (provider) => {
          lookups.push(provider);
          return { auth: { apiKey: "sk-platform-key" }, source };
        },
        getProviderKey: async (provider) => {
          lookups.push(provider);
          return "openrouter-key";
        },
        resolveOpenAIKey: async () => {
          lookups.push("extension-openai-key");
          return { key: "extension-key", source: "openai-file" };
        },
        resolveTypesafe: async () => {
          lookups.push("typesafe");
          return { key: "typesafe-key", source: "env" };
        },
      });
      expect(credentials).toEqual({
        apiKey: "sk-platform-key",
        source: expectedSource,
        transport: "openai-decisions",
      });
      expect(lookups).toEqual(["openai"]);
    }
  });

  test("falls back to the extension-owned key when Pi has no Platform API key", async () => {
    setAdvisorJevTransportRef("openai-decisions");
    const lookups: string[] = [];
    const credentials = await resolveJevTransport(undefined, {
      getProviderAuth: async (provider) => {
        lookups.push(provider);
        return { auth: { apiKey: "subscription-token" }, source: "OAuth" };
      },
      getProviderKey: async (provider) => {
        lookups.push(provider);
        return "openrouter-key";
      },
      resolveOpenAIKey: async () => {
        lookups.push("extension-openai-key");
        return { key: "extension-platform-key", source: "openai-file" };
      },
      resolveTypesafe: async () => {
        lookups.push("typesafe");
        return { key: "typesafe-key", source: "env" };
      },
    });
    expect(credentials).toEqual({
      apiKey: "extension-platform-key",
      source: "openai-file",
      transport: "openai-decisions",
    });
    expect(lookups).toEqual(["openai", "extension-openai-key"]);
  });

  test("rejects OAuth and unknown OpenAI auth sources without provider fallbacks", async () => {
    setAdvisorJevTransportRef("openai-decisions");
    for (const source of ["OAuth", "unknown source", undefined]) {
      const lookups: string[] = [];
      const credentials = await resolveJevTransport(undefined, {
        getProviderAuth: async (provider) => {
          lookups.push(provider);
          return { auth: { apiKey: "oauth-or-unknown-token" }, source };
        },
        getProviderKey: async (provider) => {
          lookups.push(provider);
          return "openrouter-key";
        },
        resolveOpenAIKey: async () => ({}),
        resolveTypesafe: async () => {
          lookups.push("typesafe");
          return { key: "typesafe-key", source: "env" };
        },
      });
      expect(credentials).toBeUndefined();
      expect(lookups).toEqual(["openai"]);
    }
  });

  test("returns no explicit OpenAI transport when both key stores are empty", async () => {
    setAdvisorJevTransportRef("openai-decisions");
    const lookups: string[] = [];
    const credentials = await resolveJevTransport(undefined, {
      getProviderAuth: async (provider) => {
        lookups.push(provider);
        return undefined;
      },
      getProviderKey: async (provider) => {
        lookups.push(provider);
        return "openrouter-key";
      },
      resolveOpenAIKey: async () => {
        lookups.push("extension-openai-key");
        return {};
      },
      resolveTypesafe: async () => {
        lookups.push("typesafe");
        return { key: "typesafe-key", source: "env" };
      },
    });
    expect(credentials).toBeUndefined();
    expect(lookups).toEqual(["openai", "extension-openai-key"]);
  });

  test("fails closed when OpenAI auth resolution throws", async () => {
    setAdvisorJevTransportRef("openai-decisions");
    const credentials = await resolveJevTransport(undefined, {
      getProviderAuth: () => Promise.reject(new Error("OAuth refresh failed")),
      resolveOpenAIKey: () => Promise.resolve({}),
      resolveTypesafe: typesafeKey,
    });
    expect(credentials).toBeUndefined();
  });
});
