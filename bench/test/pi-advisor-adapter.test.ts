import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertPiAdvisorPrerequisites,
  PiAdvisorAdapterUnavailableError,
  PiAdvisorHarborAdapter,
  parseAdvisorAttestation,
} from "../src/pi-advisor-adapter.js";

const prerequisites = (extensionPath: string) => ({
  authFile: join(extensionPath, "../auth.json"),
  authPresent: true,
  extensionPath,
  extensionVersion: "0.5.0",
  piVersion: "0.84.4",
});

describe("pi-advisor Harbor adapter boundary", () => {
  test("accepts only an attested Advisor runtime", () => {
    const attestation = parseAdvisorAttestation(
      [
        "ordinary Harbor output",
        `BENCH_ADVISOR_ATTESTATION=${JSON.stringify({
          adapter: "pi-advisor-harbor",
          advisorCalls: 1,
          extension: "pi-advisor-flow",
          extensionVersion: "0.5.0",
          loaded: true,
          mode: "advisor",
          shutdown: true,
        })}`,
      ].join("\n"),
      "0.5.0",
      "E+A"
    );
    expect(attestation.mode).toBe("advisor");
    expect(attestation.advisorCalls).toBe(1);
  });

  test("rejects plain Pi output and wrong runtime mode", () => {
    expect(() => parseAdvisorAttestation("pi completed", "0.5.0", "E")).toThrow(
      "BENCH_ADVISOR_ATTESTATION"
    );
    expect(() =>
      parseAdvisorAttestation(
        `BENCH_ADVISOR_ATTESTATION=${JSON.stringify({
          adapter: "pi-advisor-harbor",
          advisorCalls: 0,
          extension: "pi-advisor-flow",
          extensionVersion: "0.5.0",
          loaded: true,
          mode: "advisor",
          shutdown: true,
        })}`,
        "0.5.0",
        "E+A"
      )
    ).toThrow("exact expected number of consultations");
  });

  test("requires a pinned extension and Pi Codex OAuth session", () => {
    const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "bench-pi-"));
    try {
      const extensionPath = join(root, "extensions.ts");
      writeFileSync(extensionPath, "export default () => {};\n");
      expect(assertPiAdvisorPrerequisites(prerequisites(extensionPath))).toBe(
        true
      );
      expect(() =>
        assertPiAdvisorPrerequisites({
          ...prerequisites(extensionPath),
          authPresent: false,
        })
      ).toThrow(PiAdvisorAdapterUnavailableError);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("validates the attestation after the command returns", async () => {
    const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "bench-pi-"));
    try {
      const extensionPath = join(root, "extensions.ts");
      const script = join(root, "adapter.mjs");
      writeFileSync(extensionPath, "export default () => {};\n");
      const trajectoryPath = join(root, "trajectory");
      mkdirSync(join(trajectoryPath, "agent"), { recursive: true });
      mkdirSync(join(trajectoryPath, "verifier"), { recursive: true });
      writeFileSync(join(trajectoryPath, "agent", "pi.txt"), "trajectory\n");
      writeFileSync(
        join(trajectoryPath, "agent", "bench-records.jsonl"),
        "{}\n"
      );
      writeFileSync(
        join(trajectoryPath, "agent", "bench-attestation.json"),
        "{}\n"
      );
      writeFileSync(
        join(trajectoryPath, "verifier", "reward.json"),
        JSON.stringify({ reward: 1 })
      );
      const usage = {
        advisor: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 1,
          output: 1,
          totalTokens: 2,
          usageAvailable: true,
        },
        executor: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 1,
          output: 1,
          totalTokens: 2,
          usageAvailable: true,
        },
      };
      const result = {
        attestation: {
          adapter: "pi-advisor-harbor",
          advisorCalls: 1,
          extension: "pi-advisor-flow",
          extensionVersion: "0.5.0",
          loaded: true,
          mode: "advisor",
          shutdown: true,
        },
        consultations: 1,
        cost: 0,
        passed: true,
        requests: [
          {
            effort: "max",
            model: "gpt-5.6-luna",
            provider: "openai-codex",
            role: "executor",
            usage: usage.executor,
          },
          {
            effort: "medium",
            model: "gpt-5.6-sol",
            provider: "openai-codex",
            role: "advisor",
            usage: usage.advisor,
          },
        ],
        taskId: "task",
        trajectoryPath,
        usage,
      };
      const resultLine = JSON.stringify(
        `BENCH_RESULT=${JSON.stringify(result)}\n`
      );
      writeFileSync(script, `console.log(${resultLine});\n`);
      chmodSync(script, 0o755);
      const adapter = new PiAdvisorHarborAdapter({
        artifactRoot: root,
        command: process.execPath,
        extraArgs: [script],
        prerequisites: prerequisites(extensionPath),
      });
      const output = await adapter.run({
        advisor: {
          effort: "medium",
          model: "openai-codex/gpt-5.6-sol",
          role: "advisor",
        },
        arm: "E+A",
        artifactRoot: root,
        executor: {
          effort: "max",
          model: "openai-codex/gpt-5.6-luna",
          role: "executor",
        },
        seed: 101,
        taskPath: "task",
      });
      expect(output.attestation).toMatchObject({
        advisorCalls: 1,
        extensionVersion: "0.5.0",
        mode: "advisor",
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
