import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DefaultResourceLoader,
  initTheme,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8")
);
const bundledEntry = resolve(packageRoot, packageManifest.main);
const CONTEXT_WINDOW_PATTERN = /Context window[\s\S]*100k/;
const ADVISOR_EFFORT_PATTERN = /Advisor reasoning[\s\S]*off/;

const extensionContext = (cwd) => ({
  cwd,
  hasUI: true,
  isProjectTrusted: () => false,
  model: undefined,
  ui: undefined,
});

const fakeTheme = {
  description: (text) => text,
  fg: (_color, text) => text,
  hint: (text) => text,
  label: (text) => text,
  value: (text) => text,
};

const runSettingsCommand = async (handler, context, change) => {
  let rendered;
  const ui = {
    custom: async (factory) =>
      new Promise((resolveDialog) => {
        const done = () => resolveDialog(undefined);
        const selector = factory(
          { requestRender: () => undefined },
          fakeTheme,
          {},
          done
        );
        if (change) {
          // Context starts at 25k: one right-arrow selects 100k. Three down
          // arrows select Advisor reasoning, then right-arrow selects "off".
          selector.handleInput("\u001b[C");
          selector.handleInput("\u001b[B");
          selector.handleInput("\u001b[B");
          selector.handleInput("\u001b[B");
          selector.handleInput("\u001b[C");
        }
        rendered = selector.render(120).join("\n");
        selector.handleInput("\u001b");
      }),
    notify: () => undefined,
  };
  await handler("", { ...context, ui });
  return rendered;
};

test("bundled package keeps settings state shared under Node DefaultResourceLoader", async () => {
  assert.equal(packageManifest.main, "dist/index.js");
  assert.deepEqual(packageManifest.pi.extensions, ["./dist/index.js"]);
  assert.ok(existsSync(bundledEntry), `Missing built entry: ${bundledEntry}`);

  const agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-loader-agent-"));
  const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-loader-cwd-"));
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ extensions: [packageRoot] })
    );
    writeFileSync(
      join(agentDir, "advisor.json"),
      JSON.stringify({
        advisor: "provider/advisor",
        contextMaxChars: 25_000,
        executor: "provider/executor",
      })
    );

    initTheme("dark");
    const loader = new DefaultResourceLoader({ agentDir, cwd });
    await loader.reload();

    let result = loader.getExtensions();
    assert.deepEqual(
      result.errors,
      [],
      result.errors.map((error) => `${error.path}: ${error.error}`).join("\n")
    );
    assert.equal(result.extensions.length, 1);
    const [firstExtension] = result.extensions;
    assert.equal(firstExtension.resolvedPath, bundledEntry);
    const firstCommand = firstExtension.commands.get("advisor-settings");
    assert.ok(firstCommand, "advisor-settings command was not registered");

    const context = extensionContext(cwd);
    await runSettingsCommand(firstCommand.handler, context, true);

    const saved = JSON.parse(
      readFileSync(join(agentDir, "advisor.json"), "utf8")
    );
    assert.equal(saved.contextMaxChars, 100_000);
    assert.equal(saved.advisorEffort, "off");
    assert.equal(saved.executor, "provider/executor");

    await loader.reload();
    result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    const secondCommand = result.extensions[0].commands.get("advisor-settings");
    assert.ok(
      secondCommand,
      "advisor-settings command disappeared after reload"
    );
    const reopened = await runSettingsCommand(
      secondCommand.handler,
      context,
      false
    );
    assert.match(reopened, CONTEXT_WINDOW_PATTERN);
    assert.match(reopened, ADVISOR_EFFORT_PATTERN);

    // A fresh loader exercises the same packaged entry through the actual
    // Node loader path rather than relying on an in-process extension cache.
    const freshLoader = new DefaultResourceLoader({ agentDir, cwd });
    await freshLoader.reload();
    const freshCommand = freshLoader
      .getExtensions()
      .extensions[0]?.commands.get("advisor-settings");
    assert.ok(freshCommand, "advisor-settings command failed on fresh load");
    await runSettingsCommand(freshCommand.handler, context, false);
    const reloaded = JSON.parse(
      readFileSync(join(agentDir, "advisor.json"), "utf8")
    );
    assert.equal(reloaded.contextMaxChars, 100_000);
    assert.equal(reloaded.advisorEffort, "off");
    assert.equal(reloaded.executor, "provider/executor");
  } finally {
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    rmSync(agentDir, { force: true, recursive: true });
    rmSync(cwd, { force: true, recursive: true });
  }
});
