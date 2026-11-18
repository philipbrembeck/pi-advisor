import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(
  new URL("../scripts/audit.mjs", import.meta.url)
);

const allowedFinding = JSON.stringify({
  picomatch: [
    {
      id: 1_247_710,
      url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
      title:
        "picomatch vulnerable to ReDoS through single-branch repeated extglobs",
      severity: "high",
      vulnerable_versions: "<=4.0.7",
    },
  ],
});

const runAuditScript = ({
  productionOutput = "{}",
  productionStatus = "0",
  productionSignal = "",
  fullOutput = "{}",
  fullStatus = "0",
}: {
  productionOutput?: string;
  productionStatus?: string;
  productionSignal?: string;
  fullOutput?: string;
  fullStatus?: string;
} = {}) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-advisor-audit-"));
  const stubPath = join(directory, "bun");

  writeFileSync(
    stubPath,
    `#!/bin/sh
if [ -n "$AUDIT_PRODUCTION_SIGNAL" ]; then
  kill -TERM $$
fi
case " $* " in
  *" --production "*)
    printf '%s' "$AUDIT_PRODUCTION_OUTPUT"
    exit "$AUDIT_PRODUCTION_STATUS"
    ;;
  *)
    printf '%s' "$AUDIT_FULL_OUTPUT"
    exit "$AUDIT_FULL_STATUS"
    ;;
esac
`
  );
  chmodSync(stubPath, 0o755);

  try {
    return spawnSync(process.execPath, [scriptPath], {
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        AUDIT_PRODUCTION_OUTPUT: productionOutput,
        AUDIT_PRODUCTION_STATUS: productionStatus,
        AUDIT_PRODUCTION_SIGNAL: productionSignal,
        AUDIT_FULL_OUTPUT: fullOutput,
        AUDIT_FULL_STATUS: fullStatus,
      },
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

describe("dependency audit script", () => {
  test("warns and passes for only the known dev-tool advisory", () => {
    const result = runAuditScript({
      fullOutput: allowedFinding,
      fullStatus: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Temporary dev-tool audit exception");
  });

  test("blocks production findings even when they match the dev exception", () => {
    const result = runAuditScript({
      productionOutput: allowedFinding,
      productionStatus: "1",
      fullOutput: allowedFinding,
      fullStatus: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Production dependency audit failed");
  });

  test("blocks production findings even if audit exits successfully", () => {
    const result = runAuditScript({
      productionOutput: allowedFinding,
      productionStatus: "0",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Production dependency audit failed");
  });

  test("fails closed on empty production output", () => {
    const result = runAuditScript({
      productionOutput: "",
      productionStatus: "0",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Could not validate production audit output"
    );
  });

  test("does not treat an outage message with an advisory ID as an outage", () => {
    const result = runAuditScript({
      productionOutput:
        "fetch failed: https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
      productionStatus: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain("could not reach the registry");
  });

  test("fails closed on incomplete production-audit output", () => {
    const result = runAuditScript({
      productionOutput: '{"picomatch":"incomplete"}',
      productionStatus: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Could not validate production audit output"
    );
  });

  test("fails closed on malformed full-audit output", () => {
    const result = runAuditScript({
      fullOutput: `${allowedFinding}\nnetwork error`,
      fullStatus: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Could not validate full dependency audit output"
    );
  });

  test("fails closed when another finding is included", () => {
    const result = runAuditScript({
      fullOutput: JSON.stringify({
        picomatch: JSON.parse(allowedFinding).picomatch,
        other: [
          {
            url: "https://github.com/advisories/GHSA-other-1234-5678",
            title: "Another vulnerability",
            severity: "high",
            vulnerable_versions: "*",
          },
        ],
      }),
      fullStatus: "1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Full dependency audit failed");
  });

  test("preserves the registry-outage fail-open behavior with a warning", () => {
    const result = runAuditScript({
      productionOutput: "fetch failed: ECONNRESET",
      productionStatus: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("could not reach the registry");
  });

  test("fails closed when the audit process is terminated", () => {
    const result = runAuditScript({ productionSignal: "SIGTERM" });

    expect(result.status).toBe(1);
  });
});
