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

export interface HerdrAdvisorActivityScope {
  clear: () => void;
  start: () => () => void;
}

export class HerdrAdvisorActivity implements HerdrAdvisorActivityScope {
  #activeConsultations = 0;
  #activeByOwner = new Map<symbol, Set<symbol>>();
  #defaultOwner = Symbol("default Herdr Advisor activity");
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
    return this.startFor(this.#defaultOwner);
  }

  finish() {
    this.finishFor(this.#defaultOwner);
  }

  clear() {
    this.clearFor(this.#defaultOwner);
  }

  createScope(): HerdrAdvisorActivityScope {
    const owner = Symbol("Herdr Advisor runtime");
    return {
      clear: () => this.clearFor(owner),
      start: () => this.startFor(owner),
    };
  }

  private startFor(owner: symbol) {
    const lease = Symbol("Herdr activity lease");
    if (!this.enabled()) {
      return () => this.finishLease(owner, lease);
    }
    let leases = this.#activeByOwner.get(owner);
    if (!leases) {
      leases = new Set();
      this.#activeByOwner.set(owner, leases);
    }
    leases.add(lease);
    this.#activeConsultations += 1;
    if (this.#activeConsultations === 1) {
      this.safeReport(false);
    }
    return () => this.finishLease(owner, lease);
  }

  private finishFor(owner: symbol) {
    const lease = this.#activeByOwner.get(owner)?.values().next().value;
    if (lease) {
      this.finishLease(owner, lease);
    }
  }

  private finishLease(owner: symbol, lease: symbol) {
    const leases = this.#activeByOwner.get(owner);
    if (!leases?.delete(lease)) {
      return;
    }
    if (leases.size === 0) {
      this.#activeByOwner.delete(owner);
    }
    this.#activeConsultations -= 1;
    if (this.#activeConsultations === 0) {
      this.safeReport(true);
    }
  }

  private clearFor(owner: symbol) {
    const leases = this.#activeByOwner.get(owner);
    if (!leases?.size) {
      return;
    }
    this.#activeByOwner.delete(owner);
    this.#activeConsultations -= leases.size;
    if (this.#activeConsultations === 0) {
      this.safeReport(true);
    }
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
