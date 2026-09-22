import type { Report } from "./herdr-shared.ts";
import {
  BLOCK_SOURCE,
  cleanNotification,
  HERDR_PI_SOURCE,
  nextSequence,
  safeEmitBlocked,
  sendToHerdr,
} from "./herdr-shared.ts";

export class HerdrAdvisorBlock {
  #blocked = false;
  private readonly report: Report;
  private readonly enabled: () => boolean;

  constructor(
    report: Report = sendToHerdr,
    enabled: () => boolean = () => true
  ) {
    this.report = report;
    this.enabled = enabled;
  }

  set(reason: string) {
    if (!this.enabled()) {
      return;
    }
    const label = cleanNotification(reason, 200);
    const wasBlocked: boolean = this.#blocked;
    if (!wasBlocked) {
      // The listener refcounts, so only the false → true edge may emit.
      safeEmitBlocked(true, label);
    }
    this.#blocked = true;
    this.safeReport({ blocked: label });
  }

  clear() {
    const wasBlocked: boolean = this.#blocked;
    this.#blocked = false;
    if (!wasBlocked) {
      return;
    }
    // Clearing previously reported state is a de-escalation and must still be
    // delivered if integration was disabled after the block was reported.
    safeEmitBlocked(false);
    try {
      this.report({
        id: `${BLOCK_SOURCE}:${nextSequence()}`,
        method: "pane.report_metadata",
        params: {
          agent: "pi",
          applies_to_source: HERDR_PI_SOURCE,
          clear_state_labels: true,
          pane_id: process.env.HERDR_PANE_ID ?? "",
          seq: nextSequence(),
          source: BLOCK_SOURCE,
        },
      });
    } catch {
      /* Herdr is optional. */
    }
  }

  private safeReport(labels: { blocked: string }) {
    try {
      this.report({
        id: `${BLOCK_SOURCE}:${nextSequence()}`,
        method: "pane.report_metadata",
        params: {
          agent: "pi",
          applies_to_source: HERDR_PI_SOURCE,
          pane_id: process.env.HERDR_PANE_ID ?? "",
          seq: nextSequence(),
          source: BLOCK_SOURCE,
          state_labels: labels,
        },
      });
    } catch {
      /* Herdr is optional. */
    }
  }
}
