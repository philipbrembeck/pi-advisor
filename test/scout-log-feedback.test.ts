import { describe, expect, test } from "bun:test";

import {
  getAdvisorSettings,
  setAdvisorLogFeedbackRef,
} from "../src/config/state.ts";
import { appendScoutLifecycleEntry } from "../src/tools/scout-status.ts";
import { mockPi } from "./helpers/mock-pi.ts";

describe("Advisor log feedback", () => {
  test("suppresses auxiliary Scout entries when disabled", () => {
    const previous = getAdvisorSettings().logFeedback;
    const entries: { data: unknown; type: string }[] = [];

    try {
      setAdvisorLogFeedbackRef(false);
      appendScoutLifecycleEntry(mockPi({ entries }), { type: "cancelled" });
      expect(entries).toEqual([]);

      setAdvisorLogFeedbackRef(true);
      appendScoutLifecycleEntry(mockPi({ entries }), { type: "cancelled" });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.type).toBe("advisor-scout-result");
    } finally {
      setAdvisorLogFeedbackRef(previous);
    }
  });
});
