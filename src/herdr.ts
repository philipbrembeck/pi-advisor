import net from "node:net";

const SOURCE = "pi-advisor:advisor-activity";
const BLOCK_SOURCE = "pi-advisor:advisor-block";
const HERDR_PI_SOURCE = "herdr:pi";
let sequence = Date.now() * 1_000;

const nextSequence = () => ++sequence;

type HerdrRequest = {
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
};

type Report = (request: HerdrRequest) => void;

const sendToHerdr: Report = (request) => {
  if (process.env.HERDR_ENV !== "1") return;
  const paneId = process.env.HERDR_PANE_ID;
  const socketPath = process.env.HERDR_SOCKET_PATH;
  if (!paneId || !socketPath) return;

  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
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

  constructor(private readonly report: Report = sendToHerdr) {}

  start() {
    this.#activeConsultations += 1;
    if (this.#activeConsultations === 1) this.safeReport(false);
  }

  finish() {
    if (this.#activeConsultations === 0) return;
    this.#activeConsultations -= 1;
    if (this.#activeConsultations === 0) this.safeReport(true);
  }

  clear() {
    if (this.#activeConsultations === 0) return;
    this.#activeConsultations = 0;
    this.safeReport(true);
  }

  private safeReport(clear: boolean) {
    try {
      this.report(this.request(clear));
    } catch {
      // Herdr is optional; an unavailable integration must never affect advice.
    }
  }

  private request(clear: boolean): HerdrRequest {
    return {
      id: `${SOURCE}:${nextSequence()}`,
      method: "pane.report_metadata",
      params: {
        pane_id: process.env.HERDR_PANE_ID ?? "",
        source: SOURCE,
        agent: "pi",
        applies_to_source: HERDR_PI_SOURCE,
        ...(clear ? { clear_state_labels: true } : { state_labels: { working: "seeking advice" } }),
        seq: nextSequence(),
      },
    };
  }
}

export class HerdrAdvisorBlock {
  #blocked = false;

  constructor(private readonly report: Report = sendToHerdr) {}

  set(reason: string) {
    this.#blocked = true;
    this.safeReport({ blocked: reason });
  }

  clear() {
    if (!this.#blocked) return;
    this.#blocked = false;
    try {
      this.report({
        id: `${BLOCK_SOURCE}:${nextSequence()}`,
        method: "pane.report_metadata",
        params: { pane_id: process.env.HERDR_PANE_ID ?? "", source: BLOCK_SOURCE, agent: "pi", applies_to_source: HERDR_PI_SOURCE, clear_state_labels: true, seq: nextSequence() },
      });
    } catch {
      // Herdr remains optional.
    }
  }

  private safeReport(labels: { blocked: string }) {
    try {
      this.report({
        id: `${BLOCK_SOURCE}:${nextSequence()}`,
        method: "pane.report_metadata",
        params: { pane_id: process.env.HERDR_PANE_ID ?? "", source: BLOCK_SOURCE, agent: "pi", applies_to_source: HERDR_PI_SOURCE, state_labels: labels, seq: nextSequence() },
      });
    } catch {
      // Herdr remains optional.
    }
  }
}

export const herdrAdvisorActivity = new HerdrAdvisorActivity();
export const herdrAdvisorBlock = new HerdrAdvisorBlock();
