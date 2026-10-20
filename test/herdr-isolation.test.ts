import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = resolve(import.meta.dirname, "..");
const isolationPath = join(packageRoot, "test/isolate-herdr.mjs");

const transportUrl = pathToFileURL(
  join(packageRoot, "src/herdr-shared.ts")
).href;

const fixture = (runner: string) => `
import assert from "node:assert/strict";
import net from "node:net";
import { test } from ${JSON.stringify(runner)};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("isolates inherited Herdr and permits an explicit temporary target", async () => {
  assert.equal(process.env.HERDR_ENV, "0");
  assert.equal(process.env.HERDR_PANE_ID, undefined);
  assert.equal(process.env.HERDR_SOCKET_PATH, undefined);

  const { createHerdrNotificationRequest, sendToHerdr } =
    await import(${JSON.stringify(transportUrl)});
  const received = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf("\\n");
      while (newline >= 0) {
        const request = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        received.push(request);
        socket.write(JSON.stringify({ id: request.id, result: { type: "ok" } }) + "\\n");
        newline = buffer.indexOf("\\n");
      }
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(process.env.ISOLATION_SOCKET, resolve);
    });
    const disabled = createHerdrNotificationRequest("isolated", "disabled");
    sendToHerdr(disabled);
    await delay(100);
    assert.deepEqual(received, []);

    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "w999:p999";
    process.env.HERDR_SOCKET_PATH = process.env.ISOLATION_SOCKET;
    const enabled = createHerdrNotificationRequest("isolated", "enabled");
    sendToHerdr(enabled);
    const deadline = Date.now() + 2000;
    while (received.length === 0 && Date.now() < deadline) {
      await delay(10);
    }
    await delay(100);
    assert.deepEqual(received, [enabled]);
    assert.notEqual(disabled.id, enabled.id);
  } finally {
    process.env.HERDR_ENV = "0";
    delete process.env.HERDR_PANE_ID;
    delete process.env.HERDR_SOCKET_PATH;
    for (const socket of sockets) {
      socket.destroy();
    }
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
`;

const runFixture = async (entry: "bun" | "bench" | "node") => {
  const directory = await mkdtemp(join(tmpdir(), "pi-herdr-isolation-"));
  const fixturePath = join(directory, "isolation.test.mjs");
  const socketPath = join(directory, "herdr.sock");
  let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await writeFile(
      fixturePath,
      fixture(entry === "node" ? "node:test" : "bun:test")
    );

    const command =
      entry === "node"
        ? ["node", "--import", isolationPath, "--test", fixturePath]
        : [
            process.execPath,
            ...(entry === "bench" ? ["--config=./bunfig.bench.toml"] : []),
            "test",
            fixturePath,
          ];

    child = Bun.spawn(command, {
      cwd: packageRoot,
      env: {
        ...process.env,
        HERDR_ENV: "1",
        HERDR_PANE_ID: "w999:p998",
        HERDR_SOCKET_PATH: socketPath,
        ISOLATION_SOCKET: socketPath,
      },
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    });
    timeout = setTimeout(() => child?.kill(), 4000);

    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect({ exitCode, output: stdout + stderr }).toEqual({
      exitCode: 0,
      output: expect.any(String),
    });
    expect(stdout + stderr).toContain(
      "isolates inherited Herdr and permits an explicit temporary target"
    );
  } finally {
    clearTimeout(timeout);

    if (child) {
      child.kill();
      await child.exited;
    }

    await rm(directory, { force: true, recursive: true });
  }
};

describe("Herdr test isolation", () => {
  test("ordinary Bun preload isolates inherited parent targets", async () => {
    await runFixture("bun");
  });

  test("bench Bun preload isolates inherited parent targets", async () => {
    await runFixture("bench");
  });

  test("Node initialization isolates inherited parent targets", async () => {
    const loader = await readFile(
      join(packageRoot, "test/default-resource-loader.node.mjs"),
      "utf-8"
    );

    expect(loader.startsWith('import "./isolate-herdr.mjs";')).toBe(true);
    await runFixture("node");
  });
});
