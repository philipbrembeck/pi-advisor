import { getAdvisorSettings } from "./config/state.ts";
import { HerdrAdvisorBlock } from "./herdr-block.ts";
import type { HerdrMetadataRequest, Report } from "./herdr-shared.ts";
import {
  createHerdrNotificationRequest,
  HERDR_PI_SOURCE,
  nextSequence,
  sendToHerdr,
  SOURCE,
} from "./herdr-shared.ts";

export { HerdrAdvisorBlock } from "./herdr-block.ts";
export {
  createHerdrNotificationRequest,
  type HerdrMetadataRequest,
  type HerdrNotificationRequest,
  setHerdrBlockedEmitter,
} from "./herdr-shared.ts";

const metadataRequest = (clear: boolean): HerdrMetadataRequest => ({
  id: `${SOURCE}:${nextSequence()}`,
  method: "pane.report_metadata",
  params: {
    agent: "pi",
    applies_to_source: HERDR_PI_SOURCE,
    pane_id: process.env.HERDR_PANE_ID ?? "",
    source: SOURCE,
    ...(clear
      ? { clear_state_labels: true }
      : { state_labels: { working: "seeking advice" } }),
    seq: nextSequence(),
  },
});

export class HerdrAdvisorActivity {
  #activeConsultations = 0;
  private readonly report: Report;
  private readonly enabled: () => boolean;

  constructor(
    report: Report = sendToHerdr,
    enabled: () => boolean = () => true
  ) {
    this.report = report;
    this.enabled = enabled;
  }

  start() {
    if (!this.enabled()) {
      return;
    }
    this.#activeConsultations += 1;
    if (this.#activeConsultations === 1) {
      this.safeReport(false);
    }
  }

  finish() {
    if (this.#activeConsultations === 0) {
      return;
    }
    this.#activeConsultations -= 1;
    if (this.#activeConsultations === 0) {
      this.safeReport(true);
    }
  }

  clear() {
    if (this.#activeConsultations === 0) {
      return;
    }
    this.#activeConsultations = 0;
    this.safeReport(true);
  }

  private safeReport(clear: boolean) {
    try {
      this.report(metadataRequest(clear));
    } catch {
      /* Herdr is optional. */
    }
  }
}

export const notifyHerdrAdvisorFailure = (title: string, body: string) => {
  if (!getAdvisorSettings().herdrIntegration) {
    return;
  }
  try {
    sendToHerdr(createHerdrNotificationRequest(title, body));
  } catch {
    /* Herdr transport never changes Advisor safety. */
  }
};

export const herdrAdvisorActivity = new HerdrAdvisorActivity(
  sendToHerdr,
  () => getAdvisorSettings().herdrIntegration
);
export const herdrAdvisorBlock = new HerdrAdvisorBlock(
  sendToHerdr,
  () => getAdvisorSettings().herdrIntegration
);
