import { describe, expect, test } from "bun:test";

import { initTheme } from "@earendil-works/pi-coding-agent";

import { setShowUsageDetailsRef } from "../src/config/state.ts";
import { registerToolRenderers } from "../src/tools/register-renderers.ts";
import { mockPi } from "./helpers/mock-pi.ts";
import { plainThemeMock } from "./helpers/theme.ts";

initTheme();

const ESC = String.fromCodePoint(27);
const SGR_CODE = new RegExp(`${ESC}\\[[0-9;]*m`, "gu");

describe("Jev turn-gate steer renderers", () => {
  test("are registered and mirror the loop-gate shapes", () => {
    setShowUsageDetailsRef(true);
    const messageRenderers = new Map<string, any>();
    registerToolRenderers(mockPi({ messageRenderers }));
    for (const customType of [
      "advisor-turn-gate-call",
      "advisor-turn-gate-result",
    ]) {
      expect(messageRenderers.has(customType)).toBe(true);
    }

    const theme = plainThemeMock;
    const callBox = messageRenderers.get("advisor-turn-gate-call")(
      {
        content: "Proactive Advisor turn review",
        customType: "advisor-turn-gate-call",
        details: { question: "Turn gate: 2 turns without a consultation" },
      },
      { expanded: false },
      theme
    );
    const callLines = callBox
      .render(100)
      .map((line: string) => line.replace(SGR_CODE, ""));
    expect(callLines.join("\n")).toContain("[advisor]");
    expect(callLines.join("\n")).toContain(
      "Turn gate: 2 turns without a consultation"
    );

    const resultBox = messageRenderers.get("advisor-turn-gate-result")(
      {
        content: "Consider validating before claiming success.",
        customType: "advisor-turn-gate-result",
        details: {
          advisor: "test/advisor",
          text: "Consider validating before claiming success.",
          usage: { cost: { total: 0.01 }, input: 1000, output: 100 },
        },
      },
      { expanded: false },
      theme
    );
    const resultLines = resultBox
      .render(100)
      .map((line: string) => line.replace(SGR_CODE, ""));
    expect(resultLines.join("\n")).toContain("ADVISOR · TURN REVIEW");
    expect(resultLines.join("\n")).toContain("test/advisor");
    expect(resultLines.join("\n")).toContain("Usage:");
    expect(resultLines.join("\n")).toContain(
      "Consider validating before claiming success."
    );
  });
});
