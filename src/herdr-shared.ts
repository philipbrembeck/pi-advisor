import net from "node:net";

import { redactSecrets } from "./redaction.ts";

// Keep the JSON-RPC method components separate from Socket's URL-string heuristic.
const HERDR_NOTIFICATION_METHOD = "notification.show";

export const SOURCE = "pi-advisor:advisor-activity";
const NOTIFICATION_SOURCE = "pi-advisor:advisor-notification";
export const BLOCK_SOURCE = "pi-advisor:advisor-block";
export const HERDR_PI_SOURCE = "herdr:pi";

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

export type HerdrRequest = HerdrMetadataRequest | HerdrNotificationRequest;

export type Report = (request: HerdrRequest) => void;

let sequence = Date.now() * 1000;
export const nextSequence = () => {
  sequence += 1;
  return sequence;
};

// Herdr drops socket reports from other sources, so the blocked state must be
// signalled through the in-process pi event bus its integration listens on.
type BlockedEmitter = (active: boolean, label: string) => void;
let emitBlocked: BlockedEmitter | undefined;

export const setHerdrBlockedEmitter = (emitter: BlockedEmitter | undefined) => {
  emitBlocked = emitter;
};

export const safeEmitBlocked = (active: boolean, label = "Advisor blocked") => {
  try {
    emitBlocked?.(active, label);
  } catch {
    /* Herdr is optional. */
  }
};

const isControlCharacter = (character: string) =>
  character <= "\u001F" || character === "\u007F";

export const cleanNotification = (value: string, max: number) =>
  [...redactSecrets(value)]
    .map((character) => (isControlCharacter(character) ? " " : character))
    .join("")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, max);

interface HerdrAttempt {
  responded: boolean;
  wrote: boolean;
}

interface QueuedReport {
  endpoint: string;
  request: HerdrRequest;
}

interface ReportQueue {
  active: boolean;
  reports: QueuedReport[];
}

const FIRST_ATTEMPT_TIMEOUT_MS = 500;
const RETRY_ATTEMPT_TIMEOUT_MS = 1500;
const MAX_PENDING_NOTIFICATIONS = 16;
const reportQueues = new Map<string, ReportQueue>();

const isMetadataRequest = (request: HerdrRequest) =>
  request.method === "pane.report_metadata";

const reportQueueKey = (request: HerdrRequest) =>
  isMetadataRequest(request) ? request.params.source : NOTIFICATION_SOURCE;

const sendRequestAttempt = (
  endpoint: string,
  request: HerdrRequest,
  timeoutMs: number
): Promise<HerdrAttempt> => {
  const deferred = Promise.withResolvers<HerdrAttempt>();
  let settled = false;
  let wrote = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let socket: net.Socket | undefined;

  const finish = (responded: boolean) => {
    if (settled) {
      return;
    }
    settled = true;
    if (timeout) {
      clearTimeout(timeout);
    }
    socket?.destroy();
    deferred.resolve({ responded, wrote });
  };

  try {
    socket = net.createConnection(endpoint);
    socket.once("connect", () => {
      wrote = true;
      try {
        socket?.write(`${JSON.stringify(request)}\n`);
      } catch {
        finish(false);
      }
    });
    socket.once("data", () => finish(true));
    socket.once("end", () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
    timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref?.();
  } catch {
    finish(false);
  }
  return deferred.promise;
};

const sendQueuedReport = async ({ endpoint, request }: QueuedReport) => {
  const first = await sendRequestAttempt(
    endpoint,
    request,
    FIRST_ATTEMPT_TIMEOUT_MS
  );
  if (first.responded) {
    return;
  }
  if (!isMetadataRequest(request) && first.wrote) {
    return;
  }
  await sendRequestAttempt(endpoint, request, RETRY_ATTEMPT_TIMEOUT_MS);
};

const drainReportQueue = async (key: string, queue: ReportQueue) => {
  if (queue.active) {
    return;
  }
  queue.active = true;
  try {
    while (queue.reports.length > 0) {
      const report = queue.reports.shift();
      if (report) {
        try {
          await sendQueuedReport(report);
        } catch {
          continue;
        }
      }
    }
  } finally {
    queue.active = false;
    if (queue.reports.length === 0) {
      reportQueues.delete(key);
    } else {
      void drainReportQueue(key, queue);
    }
  }
};

const enqueueReport = (report: QueuedReport) => {
  const key = reportQueueKey(report.request);
  let queue = reportQueues.get(key);
  if (!queue) {
    queue = { active: false, reports: [] };
    reportQueues.set(key, queue);
  }
  if (isMetadataRequest(report.request)) {
    if (queue.active) {
      queue.reports = [report];
    } else {
      queue.reports.push(report);
    }
  } else {
    if (queue.reports.length >= MAX_PENDING_NOTIFICATIONS) {
      return;
    }
    queue.reports.push(report);
  }
  if (!queue.active) {
    void drainReportQueue(key, queue);
  }
};

export const sendToHerdr: Report = (request) => {
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
  enqueueReport({ endpoint, request });
};

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
