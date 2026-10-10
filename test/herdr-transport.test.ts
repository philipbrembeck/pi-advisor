import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import net from "node:net";

import {
  createHerdrNotificationRequest,
  sendToHerdr,
} from "../src/herdr-shared.ts";
import type { HerdrRequest } from "../src/herdr-shared.ts";
import { HerdrAdvisorActivity } from "../src/herdr.ts";

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitFor = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (condition()) {
      return;
    }
    await delay(10);
  }
  throw new Error("Timed out waiting for Herdr request");
};

const metadataRequest = (
  seq: number,
  clear = false,
  source = "test:metadata"
): HerdrRequest => ({
  id: `test:metadata:${seq}`,
  method: "pane.report_metadata",
  params: {
    agent: "pi",
    applies_to_source: "herdr:pi",
    pane_id: "w1:p1",
    seq,
    source,
    ...(clear
      ? { clear_state_labels: true }
      : { state_labels: { working: `state-${seq}` } }),
  },
});

const withHerdrSocket = async (
  onRequest: (
    request: HerdrRequest,
    connection: number,
    socket: net.Socket
  ) => void,
  run: (received: HerdrRequest[], connections: () => number) => Promise<void>
) => {
  const socketPath = `/tmp/pi-advisor-herdr-${randomUUID()}.sock`;
  const received: HerdrRequest[] = [];
  const sockets = new Set<net.Socket>();
  let connectionCount = 0;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    connectionCount += 1;
    const connection = connectionCount;
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const request: HerdrRequest = JSON.parse(line);
        received.push(request);
        onRequest(request, connection, socket);
        newline = buffer.indexOf("\n");
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });

  const previousEnvironment = {
    herdrEnv: process.env.HERDR_ENV,
    paneId: process.env.HERDR_PANE_ID,
    socketPath: process.env.HERDR_SOCKET_PATH,
  };
  process.env.HERDR_ENV = "1";
  process.env.HERDR_PANE_ID = "w1:p1";
  process.env.HERDR_SOCKET_PATH = socketPath;

  try {
    await run(received, () => connectionCount);
  } finally {
    await delay(50);
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await unlink(socketPath).catch(() => {});
    if (previousEnvironment.herdrEnv === undefined) {
      delete process.env.HERDR_ENV;
    } else {
      process.env.HERDR_ENV = previousEnvironment.herdrEnv;
    }
    if (previousEnvironment.paneId === undefined) {
      delete process.env.HERDR_PANE_ID;
    } else {
      process.env.HERDR_PANE_ID = previousEnvironment.paneId;
    }
    if (previousEnvironment.socketPath === undefined) {
      delete process.env.HERDR_SOCKET_PATH;
    } else {
      process.env.HERDR_SOCKET_PATH = previousEnvironment.socketPath;
    }
  }
};

const acknowledge = (socket: net.Socket) => {
  socket.write('{"id":"test","result":{}}\n');
};

describe("Herdr transport", () => {
  test("serializes metadata and keeps the newest pending report", async () => {
    await withHerdrSocket(
      (_request, _connection, socket) => acknowledge(socket),
      async (received) => {
        sendToHerdr(metadataRequest(1));
        sendToHerdr(metadataRequest(2));
        sendToHerdr(metadataRequest(3));
        await waitFor(() => received.length === 2);
        expect(
          received.map((request) =>
            request.method === "pane.report_metadata"
              ? request.params.seq
              : undefined
          )
        ).toEqual([1, 3]);
      }
    );
  });

  test("retries metadata after a disconnected first attempt", async () => {
    await withHerdrSocket(
      (_request, connection, socket) => {
        if (connection === 1) {
          socket.destroy();
        } else {
          acknowledge(socket);
        }
      },
      async (received, connections) => {
        sendToHerdr(metadataRequest(4));
        await waitFor(() => received.length === 2);
        expect(connections()).toBe(2);
        expect(received[0]).toEqual(received[1]);
      }
    );
  });

  test("keeps a queued clear behind an in-flight metadata retry", async () => {
    await withHerdrSocket(
      (_request, connection, socket) => {
        if (connection === 1) {
          socket.destroy();
        } else {
          acknowledge(socket);
        }
      },
      async (received) => {
        sendToHerdr(metadataRequest(5));
        sendToHerdr(metadataRequest(6, true));
        await waitFor(() => received.length === 3);
        expect(
          received.map((request) =>
            request.method === "pane.report_metadata"
              ? request.params.seq
              : undefined
          )
        ).toEqual([5, 5, 6]);
        expect(received[2]).toMatchObject({
          params: { clear_state_labels: true },
        });
        expect(received[2]).not.toHaveProperty("params.state_labels");
      }
    );
  });

  test("clears activity after disablement during a metadata retry", async () => {
    await withHerdrSocket(
      (_request, connection, socket) => {
        if (connection === 1) {
          socket.destroy();
        } else {
          acknowledge(socket);
        }
      },
      async (received) => {
        let enabled = true;
        const activity = new HerdrAdvisorActivity(sendToHerdr, () => enabled);
        activity.start();
        enabled = false;
        activity.finish();
        await waitFor(() => received.length === 3);
        expect(received[0]).toMatchObject({
          params: { state_labels: { working: "seeking advice" } },
        });
        expect(received[1]).toEqual(received[0]);
        expect(received[2]).toMatchObject({
          params: { clear_state_labels: true },
        });
        expect(received[2]).not.toHaveProperty("params.state_labels");
      }
    );
  });

  test("does not retry a notification after writing without an acknowledgement", async () => {
    await withHerdrSocket(
      () => {},
      async (received, connections) => {
        sendToHerdr(
          createHerdrNotificationRequest("Advisor failed", "No response")
        );
        await delay(700);
        expect(received).toHaveLength(1);
        expect(connections()).toBe(1);
      }
    );
  });
});
