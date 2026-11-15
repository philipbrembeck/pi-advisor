import { describe, expect, test } from "bun:test";

import {
  createScoutContextGroup,
  groupWire,
  groupWireBytes,
} from "../src/scout-group-serialization.ts";
import { SCOUT_LABEL_MAX_CHARS } from "../src/scout-types.ts";

describe("Scout group serialization", () => {
  test("preserves the wire property order and UTF-8 byte accounting", () => {
    const content = "User: review café ☕ and 👩🏽‍💻";

    const group = createScoutContextGroup(
      0,
      ["entry-1"],
      "user",
      content,
      true
    );

    const wire = groupWire(group);

    expect(Object.keys(wire)).toEqual([
      "bytes",
      "content",
      "id",
      "kind",
      "label",
      "required",
    ]);
    expect(group.bytes).toBe(Buffer.byteLength(content, "utf-8"));
    expect(groupWireBytes(group)).toBe(
      Buffer.byteLength(JSON.stringify(wire), "utf-8")
    );
    expect(group.label).toContain("User request: review café ☕ and 👩🏽‍💻");
  });

  test("keeps labels bounded and IDs stable for identical evidence", () => {
    const content = `User: ${"🙂".repeat(SCOUT_LABEL_MAX_CHARS * 2)}`;

    const first = createScoutContextGroup(
      4,
      ["entry-1"],
      "user",
      content,
      true
    );

    const same = createScoutContextGroup(4, ["entry-1"], "user", content, true);

    const different = createScoutContextGroup(
      4,
      ["entry-2"],
      "user",
      content,
      true
    );

    expect(first.id).toBe(same.id);
    expect(first.id).not.toBe(different.id);
    expect([...first.label].length).toBeLessThanOrEqual(SCOUT_LABEL_MAX_CHARS);
  });
});
