import { describe, expect, test } from "bun:test";

import type {
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
  ClassifierResult,
  ModelsClassifierOptions,
} from "@earendil-works/pi-ai";
import { getKeybindings } from "@earendil-works/pi-tui";

import type { JevClassifierKeySnapshot } from "../src/jev/classifier-key-store.ts";
import { JevClassifierSubmenu } from "../src/ui/jev-classifier-submenu.ts";
import type { JevClassifierRegistryAccess } from "../src/ui/types.ts";
import { plainThemeMock } from "./helpers/theme.ts";

const model = {
  api: "typesafe-classifier",
  baseUrl: "https://classifier.example.test",
  contextWindow: 2000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "jev-latest",
  input: ["text"],
  name: "Jev Latest",
  provider: "typesafe",
  type: "classifier",
} satisfies ClassifierModel<"typesafe-classifier">;

const goodResult: ClassifierResult = {
  answers: {
    self_answerable: { probability: 0.9, type: "bool" },
    stakes: {
      choice: "negligible",
      confidence: 0.95,
      probabilities: { high: 0.01, moderate: 0.04, negligible: 0.95 },
      type: "choice",
    },
  },
  api: "typesafe-classifier",
  model: "jev-latest",
  provider: "typesafe",
  stopReason: "stop",
  timestamp: 0,
  usage: {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 20,
    output: 2,
    totalTokens: 22,
  },
};

const registry = (
  classify: JevClassifierRegistryAccess["classify"] = async () => goodResult
): JevClassifierRegistryAccess => ({
  classify,
  findOfType: (_kind, provider, id) =>
    provider === "typesafe" && id === "jev-latest" ? model : undefined,
  getAvailableOfType: async (_kind, provider) =>
    provider === undefined || provider === "typesafe" ? [model] : [],
  getProviderDisplayName: () => "TypeSafe",
});

const makePicker = (
  modelRegistry: JevClassifierRegistryAccess,
  onSelection: (selection: { classifier?: string }) => boolean,
  options: {
    currentValue?: string;
    done?: (value?: string) => void;
    persistKey?: (key: string) => Promise<{ message: string; ok: boolean }>;
    resolveStoredKey?: () => Promise<JevClassifierKeySnapshot>;
    restoreKey?: (previous: JevClassifierKeySnapshot) => Promise<boolean>;
  } = {}
) =>
  new JevClassifierSubmenu({
    currentValue: options.currentValue ?? "Choose classifier",
    done: options.done ?? (() => {}),
    keybindings: getKeybindings(),
    modelRegistry,
    onSelection,
    persistKey: options.persistKey,
    resolveStoredKey: options.resolveStoredKey,
    restoreKey: options.restoreKey,
    theme: plainThemeMock,
    tui: { requestRender: () => {} },
  });

describe("Jev classifier picker", () => {
  test("shows available Pi-authenticated classifiers with catalog rates and explicit key option", async () => {
    const picker = makePicker(registry(), () => true);
    await picker.whenLoaded();
    const text = picker.render(100).join("\n");
    expect(text).toContain("TypeSafe / jev-latest ($0/M tokens)");
    expect(text).toContain("Jev API Key…");
  });

  test("selects a verified model and reports verification failure without changing selection", async () => {
    const selections: string[] = [];
    let doneCount = 0;

    const picker = makePicker(
      registry(),
      (selection) => {
        selections.push(selection.classifier ?? "");

        return true;
      },
      {
        done: () => {
          doneCount += 1;
        },
      }
    );

    await picker.whenLoaded();
    picker.render(100);
    picker.handleInput("\r");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(selections).toEqual(["typesafe/jev-latest"]);
    expect(doneCount).toBe(1);

    const failure = makePicker(
      registry(async () => ({
        ...goodResult,
        stopReason: "error",
      })),
      () => {
        selections.push("unexpected");

        return true;
      }
    );

    await failure.whenLoaded();
    failure.render(100);
    failure.handleInput("\r");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(selections).toEqual(["typesafe/jev-latest"]);
    expect(failure.render(100).join("\n")).toContain("Verification failed");
  });

  test("masks explicit key input, verifies request-scoped auth, and persists only after verification", async () => {
    const calls: { context: ClassifierContext; key?: string }[] = [];

    const apiRegistry = registry(
      async (
        _selected: ClassifierModel<ClassifierApi>,
        context: ClassifierContext,
        options?: ModelsClassifierOptions
      ) => {
        calls.push({ context, key: options?.apiKey });

        return goodResult;
      }
    );

    let selected: string | undefined;
    let stored: string | undefined;

    const picker = makePicker(
      apiRegistry,
      (selection) => {
        selected = selection.classifier;

        return true;
      },
      {
        persistKey: async (key) => {
          stored = key;

          return { message: "stored", ok: true };
        },
        resolveStoredKey: async () => ({}),
      }
    );

    await picker.whenLoaded();
    picker.render(100);
    picker.handleInput("\u001B[B");
    picker.handleInput("\r");
    await Promise.resolve();
    await Promise.resolve();
    expect(picker.render(100).join("\n")).toContain("Jev API Key");

    for (const character of "candidate-secret") {
      picker.handleInput(character);
    }

    expect(picker.render(100).join("\n")).not.toContain("candidate-secret");
    picker.handleInput("\r");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.map((call) => call.key)).toEqual(["candidate-secret"]);
    expect(calls[0]?.context.state).not.toHaveProperty("apiKey");
    expect(calls[0]?.context.state).toEqual({
      recent_conversation: "Classifier verification check.",
      role: "executor",
    });
    expect(stored).toBe("candidate-secret");
    expect(selected).toBe("jev-api-key");
  });

  test("does not display or store a candidate key echoed by a classifier error", async () => {
    const candidate = "candidate-secret";

    let stored = false;
    let selected = false;

    const picker = makePicker(
      registry(async () => {
        throw new Error(`request failed with ${candidate}`);
      }),
      () => {
        selected = true;

        return true;
      },
      {
        persistKey: async () => {
          stored = true;

          return { message: "stored", ok: true };
        },
        resolveStoredKey: async () => ({}),
      }
    );

    await picker.whenLoaded();
    picker.render(100);
    picker.handleInput("\u001B[B");
    picker.handleInput("\r");
    await Promise.resolve();
    await Promise.resolve();

    for (const character of candidate) {
      picker.handleInput(character);
    }

    picker.handleInput("\r");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const rendered = picker.render(100).join("\n");
    expect(rendered).not.toContain(candidate);
    expect(rendered).toContain("Jev classifier request failed.");
    expect(stored).toBe(false);
    expect(selected).toBe(false);
  });

  test("restores previous key when selection persistence fails", async () => {
    const mutations: (string | undefined)[] = [];

    const picker = makePicker(
      registry(async (_model, _context, options) => {
        if (options?.apiKey !== "new-secret") {
          throw new Error("key not passed request-scoped");
        }

        return goodResult;
      }),
      () => false,
      {
        persistKey: async (key) => {
          mutations.push(key);

          return { message: "stored", ok: true };
        },
        resolveStoredKey: async () => ({ key: "old-secret" }),
        restoreKey: async (previous) => {
          mutations.push(previous.key);

          return true;
        },
      }
    );

    await picker.whenLoaded();
    picker.render(100);
    picker.handleInput("\u001B[B");
    picker.handleInput("\u001B[B");
    picker.handleInput("\u001B[B");
    picker.handleInput("\r");
    await new Promise((resolve) => setTimeout(resolve, 0));

    for (const character of "new-secret") {
      picker.handleInput(character);
    }

    picker.handleInput("\r");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mutations).toEqual(["new-secret", "old-secret"]);
    expect(picker.render(100).join("\n")).toContain(
      "existing key was restored"
    );
  });

  test("refuses to replace the key when the stored state cannot be read", async () => {
    let persisted: string | undefined;
    let restored: JevClassifierKeySnapshot | undefined;

    const picker = makePicker(registry(), () => true, {
      persistKey: async (key) => {
        persisted = key;

        return { message: "stored", ok: true };
      },
      resolveStoredKey: async () => ({ failed: true }),
      restoreKey: async (previous) => {
        restored = previous;

        return true;
      },
    });

    await picker.whenLoaded();
    picker.render(100);
    picker.handleInput("\u001B[B");
    picker.handleInput("\r");
    await Promise.resolve();
    await Promise.resolve();

    for (const character of "candidate-secret") {
      picker.handleInput(character);
    }

    picker.handleInput("\r");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(persisted).toBeUndefined();
    expect(restored).toBeUndefined();
    expect(picker.render(100).join("\n")).toContain(
      "Could not read the stored Jev API Key state"
    );
  });
});
