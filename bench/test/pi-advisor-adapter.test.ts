import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertPiAdvisorPrerequisites,
  PiAdvisorAdapterUnavailableError,
  PiAdvisorHarborAdapter,
  parseAdvisorAttestation,
} from "../src/pi-advisor-adapter.js";

const prerequisites = (extensionPath: string) => ({
  credentialEnv: "BENCH_API_KEY",
  credentialPresent: true,
  extensionPath,
  extensionVersion: "0.5.0",
  providerBaseUrl: "https://provider.example/v1",
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
        })}`,
        "0.5.0",
        "E+A"
      )
    ).toThrow("at least one Advisor consultation");
  });

  test("requires a pinned extension, endpoint, and credential", () => {
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
          credentialPresent: false,
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
      const result = {
        attestation: {
          adapter: "pi-advisor-harbor",
          advisorCalls: 1,
          extension: "pi-advisor-flow",
          extensionVersion: "0.5.0",
          loaded: true,
          mode: "advisor",
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
          },
          {
            effort: "medium",
            model: "gpt-5.6-sol",
            provider: "openai-codex",
            role: "advisor",
          },
        ],
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
