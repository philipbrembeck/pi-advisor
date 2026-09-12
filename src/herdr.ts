import net from "node:net";
import { getAdvisorSettings } from "./config/state.ts";
import { redactSecrets } from "./redaction.ts";

// Keep the JSON-RPC method components separate from Socket's URL-string heuristic.
const HERDR_NOTIFICATION_METHOD = "notification.show";

const SOURCE = "pi-advisor:advisor-activity";
const BLOCK_SOURCE = "pi-advisor:advisor-block";
const NOTIFICATION_SOURCE = "pi-advisor:advisor-notification";
const HERDR_PI_SOURCE = "herdr:pi";
let sequence = Date.now() * 1000;
const nextSequence = () => {
  sequence += 1;
  return sequence;
};

export interface HerdrMetadataRequest {
  id: string;
  method: "pane.report_metadata";
  params: {
    pane_id: string;
    source: string;
    agent: "pi";
    applies_to_source: string;
    state_labels?: { working?: string; blocked?: string };
    clear_state_labels?: true;
    seq: number;
  };
}
export interface HerdrNotificationRequest {
  id: string;
  method: typeof HERDR_NOTIFICATION_METHOD;
  params: {
    title: string;
    body: string;
    position: "top-left";
    sound: "request";
  };
}
type HerdrRequest = HerdrMetadataRequest | HerdrNotificationRequest;
type Report = (request: HerdrRequest) => void;

// Herdr only accepts semantic state from the pane's lifecycle authority, which
// for pi is herdr's own herdr-agent-state extension (source "herdr:pi"). Socket
// reports from any other source are dropped, so the blocked state has to be
// signalled through the in-process pi event bus that integration listens on.
type BlockedEmitter = (active: boolean, label: string) => void;
let emitBlocked: BlockedEmitter | undefined;

export const setHerdrBlockedEmitter = (emitter: BlockedEmitter | undefined) => {
  emitBlocked = emitter;
};

const safeEmitBlocked = (active: boolean, label = "Advisor blocked") => {
  try {
    emitBlocked?.(active, label);
  } catch {
    /* Herdr is optional. */
  }
};

const isControlCharacter = (character: string) =>
  character <= "\u001f" || character === "\u007f";

const cleanNotification = (value: string, max: number) =>
  [...redactSecrets(value)]
    .map((character) => (isControlCharacter(character) ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export const createHerdrNotificationRequest = (
  title: string,
  body: string
): HerdrNotificationRequest => ({
  id: `${NOTIFICATION_SOURCE}:${nextSequence()}`,
  method: HERDR_NOTIFICATION_METHOD,
  params: {
    body: cleanNotification(body, 240),
    position: "top-left",
    sound: "request",
    title: cleanNotification(title, 80),
  },
});

const sendToHerdr: Report = (request) => {
  if (process.env.HERDR_ENV !== "1") {
    return;
  }
  const paneId = process.env.HERDR_PANE_ID;
  const socketPath = process.env.HERDR_SOCKET_PATH;
  if (!(paneId && socketPath)) {
    return;
  }
  const endpoint =
    process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
  const socket = net.createConnection(endpoint);
  const timeout = setTimeout(() => socket.destroy(), 500);
  timeout.unref?.();
  socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
  socket.once("data", () => socket.destroy());
  socket.once("error", () => socket.destroy());
  socket.once("close", () => clearTimeout(timeout));
};

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
      this.report(this.request(clear));
    } catch {
      /* Herdr is optional. */
    }
  }

  private request(clear: boolean): HerdrMetadataRequest {
    return {
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
    };
  }
}

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
