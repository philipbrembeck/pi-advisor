import { describe, expect, test } from "bun:test";
import {
  buildScoutManifest,
  reconstructScoutConversation,
} from "../src/scout-context.js";

const entry = (id: string, message: unknown) => ({
  id,
  message,
  parentId: null,
  timestamp: "2026-01-01T00:00:00Z",
  type: "message",
});
const user = (id: string, content: string) =>
  entry(id, { content, role: "user", timestamp: 1 });
const assistant = (id: string, content: unknown[], stopReason = "toolUse") =>
  entry(id, {
    api: "test",
    content,
    model: "model",
    provider: "provider",
    role: "assistant",
    stopReason,
    timestamp: 1,
    usage: {},
  });
const result = (id: string, callId: string, name: string, content: string) =>
  entry(id, {
    content: [{ text: content, type: "text" }],
    isError: false,
    role: "toolResult",
    timestamp: 1,
    toolCallId: callId,
    toolName: name,
  });
const context = (entries: unknown[]) =>
  ({ sessionManager: { buildContextEntries: () => entries } }) as any;

describe("Scout context", () => {
  test("groups parallel tool calls and all matching results atomically", () => {
    const built = buildScoutManifest(
      context([
        user("u1", "do the work"),
        assistant("a1", [
          {
            arguments: { path: "a" },
            id: "c1",
            name: "read",
            type: "toolCall",
          },
          {
            arguments: { path: "b" },
            id: "c2",
            name: "read",
            type: "toolCall",
          },
        ]),
        result("r1", "c1", "read", "first"),
        result("r2", "c2", "read", "second"),
      ])
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(built.manifest.groups).toHaveLength(2);
    const [, exchange] = built.manifest.groups;
    expect(exchange.kind).toBe("tool-exchange");
    expect(exchange.content).toContain("first");
    expect(exchange.content).toContain("second");
  });

  test("rejects duplicate calls and adjacent unknown tool results", () => {
    for (const entries of [
      [
        assistant("a1", [
          { arguments: {}, id: "c1", name: "read", type: "toolCall" },
        ]),
        result("r1", "other", "read", "unknown"),
      ],
      [
        assistant("a2", [
          { arguments: {}, id: "same", name: "read", type: "toolCall" },
          { arguments: {}, id: "same", name: "bash", type: "toolCall" },
        ]),
      ],
      [
        assistant("a3", [
          {
            arguments: {},
            id: "duplicate-result",
            name: "read",
            type: "toolCall",
          },
        ]),
        result("r2", "duplicate-result", "read", "first"),
        result("r3", "duplicate-result", "read", "second"),
      ],
    ]) {
      const built = buildScoutManifest(context(entries));
      expect(built).toMatchObject({ ok: false, reason: "invalid-protocol" });
    }
  });

  test("omits historical results whose originating call is unavailable", () => {
    const built = buildScoutManifest(
      context([
        result("r1", "missing", "read", "orphaned output"),
        user("u1", "current"),
      ])
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(built.manifest.omittedCount).toBe(1);
    expect(built.manifest.omittedBytes).toBeGreaterThan(0);
    expect(
      built.manifest.groups.map((group) => group.content).join("\n")
    ).not.toContain("orphaned output");
  });

  test("pairs noncontiguous retained results by tool-call ID", () => {
    const built = buildScoutManifest(
      context([
        assistant("a1", [
          { arguments: {}, id: "c1", name: "read", type: "toolCall" },
        ]),
        user("u1", "intervening retained entry"),
        result("r1", "c1", "read", "late result"),
        user("u2", "current"),
      ])
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const exchange = built.manifest.groups.find(
      (group) => group.kind === "tool-exchange"
    );
    expect(exchange?.content).toContain("late result");
    expect(
      built.manifest.groups.filter((group) => group.kind === "tool-exchange")
    ).toHaveLength(1);
  });

  test("omits whole incomplete historical tool groups before Scout", () => {
    const built = buildScoutManifest(
      context([
        assistant("a1", [
          { arguments: {}, id: "c1", name: "read", type: "toolCall" },
        ]),
        user("u1", "current request"),
      ])
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(built.manifest.omittedCount).toBe(1);
    expect(built.manifest.omittedBytes).toBeGreaterThan(0);
    expect(
      built.manifest.groups.map((group) => group.content).join("\n")
    ).not.toContain("Tool Call: read");
  });

  test("allows only the current single pending ask_advisor invocation", () => {
    const built = buildScoutManifest(
      context([
        user("u1", "review this"),
        assistant("a1", [
          {
            arguments: {},
            id: "advisor-call",
            name: "ask_advisor",
            type: "toolCall",
          },
        ]),
      ]),
      { currentInvocationId: "advisor-call" }
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(built.manifest.groups.at(-1)).toMatchObject({
      kind: "pending-invocation",
      required: true,
    });
  });

  test("retains the current automatic-gate tool invocation", () => {
    const built = buildScoutManifest(
      context([
        assistant("a1", [
          {
            arguments: { command: "pwd" },
            id: "bash-call",
            name: "bash",
            type: "toolCall",
          },
        ]),
      ]),
      {
        currentInvocationId: "bash-call",
        policies: {},
        redact: false,
      }
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(built.manifest.groups).toMatchObject([
      { content: expect.stringContaining('"command":"pwd"') },
    ]);
    expect(built.manifest.groups[0].kind).toBe("pending-invocation");
  });

  test("keeps current Advisor arguments within the Scout privacy allowlist", () => {
    const built = buildScoutManifest(
      context([
        user("u1", "review this"),
        assistant("a1", [
          {
            arguments: {
              draft: "private draft",
              gitContext: "summary",
              includeTrackedFiles: ["src/private.ts"],
              includeUntracked: ["scratch.txt"],
              question: "Should this ship?",
            },
            id: "advisor-call",
            name: "ask_advisor",
            type: "toolCall",
          },
        ]),
      ]),
      { currentInvocationId: "advisor-call" }
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const pending = built.manifest.groups.at(-1);
    expect(pending?.kind).toBe("pending-invocation");
    expect(pending?.content).toContain('"gitContext":"summary"');
    expect(pending?.content).toContain('"question":"Should this ship?"');
    expect(pending?.content).not.toContain("private draft");
    expect(pending?.content).not.toContain("src/private.ts");
    expect(pending?.content).not.toContain("scratch.txt");
  });

  test("keeps manifest transport and Advisor conversation budgets separate", () => {
    const entries = [
      user("u1", "current request ".repeat(40)),
      assistant("a1", [
        {
          arguments: { question: "review this ".repeat(40) },
          id: "advisor-call",
          name: "ask_advisor",
          type: "toolCall",
        },
      ]),
    ];
    const wide = buildScoutManifest(context(entries), {
      currentInvocationId: "advisor-call",
      maxConversationChars: 2000,
      maxManifestBytes: 10_000,
    });
    expect(wide.ok).toBe(true);
    if (!wide.ok) {
      return;
    }
    const manifestBytes = Buffer.byteLength(
      JSON.stringify(
        wide.manifest.groups.map((group) => ({
          bytes: group.bytes,
          content: group.content,
          id: group.id,
          kind: group.kind,
          label: group.label,
          required: group.required,
        }))
      ),
      "utf8"
    );
    expect(manifestBytes).toBeGreaterThan(1000);

    const separate = buildScoutManifest(context(entries), {
      currentInvocationId: "advisor-call",
      maxConversationChars: 2000,
      maxManifestBytes: manifestBytes + 1,
    });
    expect(separate.ok).toBe(true);
  });

  test("zero Scout budget produces no history groups", () => {
    const built = buildScoutManifest(context([user("u1", "current request")]), {
      maxBytes: 0,
    });
    expect(built).toMatchObject({ manifest: { groups: [] }, ok: true });
  });

  test("marks the latest user request required and reconstructs original order", () => {
    const built = buildScoutManifest(
      context([
        user("u1", "old request"),
        assistant("a1", [{ text: "old answer", type: "text" }], "stop"),
        user("u2", "current request"),
      ])
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(built.manifest.groups.map((group) => group.required)).toEqual([
      false,
      false,
      true,
    ]);
    const conversation = reconstructScoutConversation(
      built.manifest,
      [built.manifest.groups[0].id],
      "The decision remains open."
    );
    expect(conversation.indexOf("old request")).toBeLessThan(
      conversation.indexOf("current request")
    );
    expect(conversation).toContain("untrusted, non-authoritative inference");
  });

  test("caps reconstructed Scout context to the remaining character budget", () => {
    const built = buildScoutManifest(context([user("u1", "current request")]), {
      maxBytes: 10_000,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const conversation = reconstructScoutConversation(
      built.manifest,
      built.manifest.groups.map((group) => group.id),
      "synthesis that must be bounded",
      13
    );
    expect(conversation.length).toBe(13);
    expect(conversation).toContain("User: current");
  });

  test("fails open when required request or atomic invocation exceeds limits", () => {
    const oversized = buildScoutManifest(
      context([user("u1", "x".repeat(50))]),
      {
        maxBytes: 1000,
        maxGroupBytes: 20,
      }
    );
    expect(oversized).toMatchObject({
      ok: false,
      reason: "required-group-overflow",
    });
    const atomic = buildScoutManifest(
      context([
        user("u1", "current"),
        assistant("a1", [
          {
            arguments: {
              draft: "private draft",
              question: "x".repeat(100),
            },
            id: "advisor-call",
            name: "ask_advisor",
            type: "toolCall",
          },
        ]),
      ]),
      {
        currentInvocationId: "advisor-call",
        maxBytes: 1000,
        maxGroupBytes: 50,
      }
    );
    expect(atomic).toMatchObject({
      ok: false,
      reason: "required-group-overflow",
    });
    const aggregate = buildScoutManifest(
      context([user("u1", "first"), user("u2", "second")]),
      { maxBytes: 1, maxGroupBytes: 1000 }
    );
    expect(aggregate).toMatchObject({
      ok: false,
      reason: "required-group-overflow",
    });
  });

  test("omits whole oldest optional groups deterministically within caps", () => {
    const entries = [
      user("u1", "oldest"),
      assistant("a1", [{ text: "middle", type: "text" }], "stop"),
      user("u2", "required newest"),
    ];
    const first = buildScoutManifest(context(entries), {
      maxBytes: 10_000,
      maxGroupBytes: 1000,
      maxGroups: 2,
    });
    const second = buildScoutManifest(context(entries), {
      maxBytes: 10_000,
      maxGroupBytes: 1000,
      maxGroups: 2,
    });
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    if (!first.ok) {
      return;
    }
    expect(first.manifest.omittedCount).toBe(1);
    expect(
      first.manifest.groups.map((group) => group.content).join("\n")
    ).not.toContain("oldest");
  });

  test("reuses disclosure policies, caps, and secret redaction", () => {
    const built = buildScoutManifest(
      context([
        user("u1", "token=secret-value"),
        assistant("a1", [
          {
            arguments: { token: "private" },
            id: "c1",
            name: "bash",
            type: "toolCall",
          },
        ]),
        result("r1", "c1", "bash", "private output"),
      ]),
      {
        policies: { bash: "summary" },
        redact: true,
        toolResultMaxBytes: 10,
        toolResultMaxLines: 1,
      }
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const content = built.manifest.groups
      .map((group) => group.content)
      .join("\n");
    expect(content).toContain("[REDACTED SECRET]");
    expect(content).toContain("arguments omitted");
    expect(content).not.toContain("private output");
  });

  test("uses bounded labels and stable collision-safe IDs", () => {
    const entries = [user("u1", "same"), user("u2", "same")];
    const built = buildScoutManifest(context(entries));
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(new Set(built.manifest.groups.map((group) => group.id)).size).toBe(
      2
    );
    expect(
      built.manifest.groups.every((group) => [...group.label].length <= 160)
    ).toBe(true);
  });
});
