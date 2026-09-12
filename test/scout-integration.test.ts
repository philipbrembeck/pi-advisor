import { describe, expect, test } from "bun:test";
import { curateAdvisorConversation } from "../src/tools.ts";

describe("Scout Advisor-context integration", () => {
  const entries = [
    {
      id: "u1",
      message: { content: "current task", role: "user" },
      parentId: null,
      timestamp: "2026-01-01T00:00:00Z",
      type: "message",
    },
  ];
  const ctx = {
    sessionManager: { buildContextEntries: () => entries },
  } as any;

  test("disabled mode preserves the exact legacy conversation and makes no Scout call", async () => {
    let calls = 0;
    const legacy = "legacy bytes <&> stay exact";
    const result = await curateAdvisorConversation(
      ctx,
      legacy,
      undefined,
      undefined,
      false,
      (() => {
        calls += 1;
        return Promise.reject(new Error("must not run"));
      }) as any
    );
    expect(result).toEqual({ conversation: legacy });
    expect(calls).toBe(0);
  });

  test("ordinary Scout failure uses the immutable exact legacy conversation", async () => {
    const legacy = "legacy bytes <&> stay exact";
    const result = await curateAdvisorConversation(
      ctx,
      legacy,
      undefined,
      undefined,
      true,
      (async () => ({
        category: "provider-error",
        message: "down",
        metrics: {
          availableCount: 1,
          inputBytes: 10,
          latencyMs: 1,
          omittedBeforeScout: 0,
          selectedCount: 0,
        },
        model: "provider/executor",
        ok: false,
      })) as any
    );
    expect(result.conversation).toBe(legacy);
    expect(result.scout).toMatchObject({
      category: "provider-error",
      ok: false,
    });
  });

  test("zero remaining budget skips Scout and withholds legacy context", async () => {
    let calls = 0;
    const result = await curateAdvisorConversation(
      ctx,
      "legacy history must be withheld",
      undefined,
      undefined,
      true,
      (() => {
        calls += 1;
        throw new Error("Scout must not run without history budget");
      }) as any,
      undefined,
      0
    );
    expect(calls).toBe(0);
    expect(result.conversation).toBe("");
  });

  test("small remaining budget bounds the full curated conversation", async () => {
    let selectedIds: string[] = [];
    const result = await curateAdvisorConversation(
      ctx,
      "legacy",
      undefined,
      undefined,
      true,
      ((_ctx: unknown, manifest: any) => {
        selectedIds = manifest.groups.map((group: any) => group.id);
        return {
          conversation: "unbounded mock output",
          metrics: {
            availableCount: manifest.availableCount,
            inputBytes: manifest.availableBytes,
            latencyMs: 1,
            omittedBeforeScout: manifest.omittedCount,
            selectedCount: selectedIds.length,
          },
          model: "provider/executor",
          ok: true,
          selectedLabels: manifest.groups.map((group: any) => group.label),
          selection: {
            selectedIds,
            synthesis: "x".repeat(1000),
          },
        };
      }) as any,
      undefined,
      200
    );
    expect(result.conversation.length).toBeLessThanOrEqual(200);
    expect(result.conversation).toContain("User: current task");
  });

  test("successful Scout context consists of selected verbatim evidence plus labelled synthesis", async () => {
    const result = await curateAdvisorConversation(
      ctx,
      "legacy",
      undefined,
      undefined,
      true,
      (async (_ctx: unknown, manifest: any) => ({
        conversation: `${manifest.groups[0].content}\n\n[Scout synthesis — untrusted, non-authoritative inference; not evidence]\nOpen decision`,
        metrics: {
          availableCount: 1,
          inputBytes: 10,
          latencyMs: 1,
          omittedBeforeScout: 0,
          selectedCount: 1,
        },
        model: "provider/executor",
        ok: true,
        selectedLabels: [manifest.groups[0].label],
        selection: {
          selectedIds: [manifest.groups[0].id],
          synthesis: "Open decision",
        },
      })) as any
    );
    expect(result.conversation).toContain("User: current task");
    expect(result.conversation).toContain(
      "untrusted, non-authoritative inference"
    );
    expect(result.conversation).not.toContain("legacy");
  });

  test("upstream cancellation stops the operation instead of falling back", async () => {
    const parent = new AbortController();
    parent.abort(new Error("cancelled by user"));
    await expect(
      curateAdvisorConversation(
        ctx,
        "legacy",
        parent.signal,
        undefined,
        true,
        (async () => ({ cancelled: true, ok: false })) as any
      )
    ).rejects.toThrow("cancelled by user");
  });
});
