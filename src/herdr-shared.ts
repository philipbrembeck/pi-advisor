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
  const socket = net.createConnection(endpoint);
  const timeout = setTimeout(() => socket.destroy(), 500);
  timeout.unref?.();
  socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
  socket.once("data", () => socket.destroy());
  socket.once("error", () => socket.destroy());
  socket.once("close", () => clearTimeout(timeout));
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
