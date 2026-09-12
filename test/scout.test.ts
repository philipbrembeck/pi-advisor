/* biome-ignore-all lint/performance/noAwaitInLoops: table-driven async failure cases intentionally run serially. */
/* biome-ignore-all lint/suspicious/useAwait: async dependency stubs mirror the production contract. */
import { describe, expect, test } from "bun:test";
import { setExecutorEffortRef, setExecutorRef } from "../src/config.ts";
import {
  parseScoutSelection,
  runAdvisorScout,
  SCOUT_SYSTEM,
} from "../src/scout.ts";
import type { ScoutManifest } from "../src/scout-context.ts";
import { ScoutStatusManager } from "../src/tools.ts";

const manifest = (): ScoutManifest => ({
  availableBytes: 100,
  availableCount: 3,
  groups: [
    {
      bytes: 10,
      content: "User: current task",
      id: "g_required",
      kind: "user",
      label: "current task",
      originalIndex: 2,
      required: true,
    },
    {
      bytes: 10,
      content: "Executor: useful failure",
      id: "g_failure",
      kind: "assistant",
      label: "useful failure",
      originalIndex: 0,
      required: false,
    },
    {
      bytes: 10,
      content: "Executor: redundant",
      id: "g_other",
      kind: "assistant",
      label: "redundant",
      originalIndex: 1,
      required: false,
    },
  ],
  omittedBytes: 5,
  omittedCount: 1,
});

const resolved = {
  apiKey: "key",
  model: { id: "model", provider: "provider" },
  ref: "provider/model",
} as any;
const successDependencies = (
  text: string,
  capture?: (options: any) => void
) => ({
  collect: (_resolved: unknown, options: any) => {
    capture?.(options);
    return Promise.resolve({
      text,
      thinking: "thought",
      usage: { cost: { total: 0.01 } },
    });
  },
  resolve: () => Promise.resolve(resolved),
});

describe("Advisor Scout", () => {
  test("parses a valid selection and retains useful failures", () => {
    const selection = parseScoutSelection(
      JSON.stringify({
        selectedIds: ["g_required", "g_failure"],
        synthesis: "Failure explains the remaining decision.",
      }),
      manifest()
    );
    expect(selection.selectedIds).toContain("g_failure");
  });

  test("ignores hallucinated IDs and retains required groups", () => {
    const selection = parseScoutSelection(
      JSON.stringify({
        selectedIds: ["g_unknown", "g_failure"],
        synthesis: "Failure explains the remaining decision.",
      }),
      manifest()
    );
    expect(selection.selectedIds).toEqual(["g_required", "g_failure"]);

    const requiredOnly = parseScoutSelection(
      JSON.stringify({
        selectedIds: ["g_unknown"],
        synthesis: "Inference based on an unknown selection.",
      }),
      manifest()
    );
    expect(requiredOnly.selectedIds).toEqual(["g_required"]);
    expect(requiredOnly.synthesis).toBe("");

    const normalized = parseScoutSelection(
      JSON.stringify({
        selectedIds: ["g_other", "g_required", "g_failure"],
        synthesis: "Selections are normalized to manifest order.",
      }),
      manifest()
    );
    expect(normalized.selectedIds).toEqual([
      "g_required",
      "g_failure",
      "g_other",
    ]);
  });

  test("rejects malformed, duplicate, oversized, and extra-key output", () => {
    const invalid = [
      "not json",
      JSON.stringify({
        selectedIds: ["g_required", "g_required"],
        synthesis: "",
      }),
      JSON.stringify({
        selectedIds: ["g_unknown", "g_unknown"],
        synthesis: "",
      }),
      JSON.stringify({
        selectedIds: ["g_required"],
        synthesis: "x".repeat(4097),
      }),
      JSON.stringify({
        extra: true,
        selectedIds: ["g_required"],
        synthesis: "",
      }),
    ];
    for (const value of invalid) {
      expect(() => parseScoutSelection(value, manifest())).toThrow();
    }
  });

  test("uses the configured Executor model and effort with conversation-only input", async () => {
    setExecutorRef("provider/executor");
    setExecutorEffortRef("high");
    let options: any;
    const events: string[] = [];
    const outcome = await runAdvisorScout(
      {} as any,
      manifest(),
      undefined,
      (event) => events.push(event.type),
      1000,
      successDependencies(
        JSON.stringify({
          selectedIds: ["g_required", "g_failure"],
          synthesis: "Open decision.",
        }),
        (value) => {
          options = value;
        }
      ) as any
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.model).toBe("provider/executor");
    expect(outcome.conversation).toContain("useful failure");
    expect(outcome.conversation).toContain("non-authoritative inference");
    expect(outcome.metrics.usage).toEqual({ cost: 0.01 });
    expect(options.reasoning).toBe("high");
    expect(options.systemPrompt).toBe(SCOUT_SYSTEM);
    const input = JSON.stringify(options.messages);
    expect(input).toContain("current task");
    expect(input).not.toContain("repository_changes");
    expect(input).not.toContain("tracked_files");
    expect(events).toEqual(["call", "success"]);
  });

  test("classifies missing model and auth failures without substitution", async () => {
    setExecutorRef("provider/missing");
    for (const [message, category] of [
      ["Scout model not found: provider/missing", "missing-model"],
      ["No API key for provider/missing", "auth-error"],
    ] as const) {
      const outcome = await runAdvisorScout(
        {} as any,
        manifest(),
        undefined,
        undefined,
        100,
        {
          collect: async () => {
            throw new Error("must not run");
          },
          resolve: async () => {
            throw new Error(message);
          },
        } as any
      );
      expect(outcome).toMatchObject({ category, ok: false });
    }
  });

  test("classifies empty and invalid responses as fallback", async () => {
    for (const [text, category] of [
      ["", "empty-response"],
      ["{}", "invalid-selection"],
    ] as const) {
      const outcome = await runAdvisorScout(
        {} as any,
        manifest(),
        undefined,
        undefined,
        100,
        successDependencies(text) as any
      );
      expect(outcome).toMatchObject({ category, ok: false });
    }
  });

  test("retains required groups within the selection limit", () => {
    const groups = Array.from({ length: 33 }, (_, index) => ({
      ...manifest().groups[1],
      id: `g_optional_${index}`,
      label: `optional ${index}`,
      originalIndex: index,
    }));
    const boundedManifest: ScoutManifest = {
      ...manifest(),
      groups: [manifest().groups[0], ...groups],
    };
    const selection = parseScoutSelection(
      JSON.stringify({
        selectedIds: groups.map((group) => group.id).reverse(),
        synthesis: "Keep the most relevant evidence.",
      }),
      boundedManifest
    );
    expect(selection.selectedIds).toHaveLength(32);
    expect(selection.selectedIds[0]).toBe("g_required");
    expect(selection.selectedIds).toContain("g_optional_32");
    expect(selection.selectedIds).not.toContain("g_optional_0");
  });

  test("rejects manifests with too many required groups", () => {
    const oversizedManifest: ScoutManifest = {
      ...manifest(),
      groups: Array.from({ length: 33 }, (_, index) => ({
        ...manifest().groups[0],
        id: `g_required_${index}`,
        label: `required ${index}`,
        originalIndex: index,
      })),
    };
    expect(() =>
      parseScoutSelection(
        JSON.stringify({ selectedIds: [], synthesis: "" }),
        oversizedManifest
      )
    ).toThrow("Manifest contains more than 32 required groups");
  });

  test("curates successfully when the model includes an unknown group ID", async () => {
    const outcome = await runAdvisorScout(
      {} as any,
      manifest(),
      undefined,
      undefined,
      100,
      successDependencies(
        JSON.stringify({
          selectedIds: ["g_unknown", "g_failure"],
          synthesis: "Useful failure retained.",
        })
      ) as any
    );
    expect(outcome).toMatchObject({
      metrics: { selectedCount: 2 },
      ok: true,
      selectedLabels: ["current task", "useful failure"],
    });
    if (!outcome.ok) {
      return;
    }
    expect(outcome.selection.selectedIds).toEqual(["g_required", "g_failure"]);
  });

  test("times out as fallback and propagates its abort signal", async () => {
    let childSignal: AbortSignal | undefined;
    const outcome = await runAdvisorScout(
      {} as any,
      manifest(),
      undefined,
      undefined,
      5,
      {
        collect: async (_resolved: unknown, options: any) => {
          childSignal = options.signal;
          await new Promise((_resolve, reject) =>
            options.signal.addEventListener(
              "abort",
              () => reject(options.signal.reason),
              {
                once: true,
              }
            )
          );
          throw new Error("unreachable");
        },
        resolve: async () => resolved,
      } as any
    );
    expect(childSignal?.aborted).toBe(true);
    expect(outcome).toMatchObject({ category: "timeout", ok: false });
  });

  test("parent abort cancels and never reports fallback", async () => {
    const parent = new AbortController();
    const events: string[] = [];
    const promise = runAdvisorScout(
      {} as any,
      manifest(),
      parent.signal,
      (event) => events.push(event.type),
      1000,
      {
        collect: async (_resolved: unknown, options: any) => {
          await new Promise((_resolve, reject) =>
            options.signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              {
                once: true,
              }
            )
          );
          throw new Error("unreachable");
        },
        resolve: async () => resolved,
      } as any
    );
    parent.abort();
    const outcome = await promise;
    expect(outcome).toEqual({ cancelled: true, ok: false });
    expect(events).toContain("cancelled");
    expect(events).not.toContain("fallback");
  });

  test("provider failures retain separate Scout metrics", async () => {
    const outcome = await runAdvisorScout(
      {} as any,
      manifest(),
      undefined,
      undefined,
      100,
      {
        collect: async () => {
          throw new Error("provider unavailable");
        },
        resolve: async () => resolved,
      } as any
    );
    expect(outcome).toMatchObject({
      category: "provider-error",
      metrics: { availableCount: 3, omittedBeforeScout: 1, selectedCount: 0 },
      ok: false,
    });
  });
});

describe("Scout status ownership", () => {
  const context = (statuses: Array<string | undefined>) =>
    ({
      hasUI: true,
      ui: {
        setStatus: (_key: string, value: string | undefined) =>
          statuses.push(value),
      },
    }) as any;

  test("keeps a newer active status when an older invocation releases", () => {
    const statuses: Array<string | undefined> = [];
    const manager = new ScoutStatusManager();
    const ctx = context(statuses);
    const older = Symbol("older");
    const newer = Symbol("newer");
    manager.update(ctx, older, { model: "executor", type: "call" });
    manager.update(ctx, newer, { model: "executor", type: "call" });
    manager.release(ctx, older);
    expect(statuses.at(-1)).toBe("Scout curating…");
    manager.release(ctx, newer);
    expect(statuses.at(-1)).toBeUndefined();
  });

  test("shutdown clear prevents late callbacks from reacquiring status", () => {
    const statuses: Array<string | undefined> = [];
    const manager = new ScoutStatusManager();
    const ctx = context(statuses);
    const token = Symbol("old-session");
    manager.update(ctx, token, { model: "executor", type: "call" });
    manager.clear(ctx);
    manager.update(ctx, token, {
      model: "executor",
      text: "",
      thinking: "",
      type: "chunk",
    });
    expect(statuses).toEqual(["Scout curating…", undefined]);
  });

  test("success, fallback, and cancellation release their status", () => {
    for (const event of [
      {
        outcome: {
          conversation: "selected",
          metrics: {
            availableCount: 1,
            inputBytes: 1,
            latencyMs: 1,
            omittedBeforeScout: 0,
            selectedCount: 1,
          },
          model: "executor",
          ok: true,
          selectedLabels: [],
          selection: { selectedIds: [], synthesis: "" },
        },
        type: "success",
      },
      {
        outcome: {
          category: "timeout",
          message: "timeout",
          metrics: {
            availableCount: 1,
            inputBytes: 1,
            latencyMs: 1,
            omittedBeforeScout: 0,
            selectedCount: 0,
          },
          model: "executor",
          ok: false,
        },
        type: "fallback",
      },
      { type: "cancelled" },
    ] as const) {
      const statuses: Array<string | undefined> = [];
      const manager = new ScoutStatusManager();
      const ctx = context(statuses);
      const token = Symbol("invocation");
      manager.update(ctx, token, { model: "executor", type: "call" });
      manager.update(ctx, token, event as any);
      expect(statuses.at(-1)).toBeUndefined();
    }
  });
});
