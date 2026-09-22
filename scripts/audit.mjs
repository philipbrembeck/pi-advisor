import { spawnSync } from "node:child_process";

// Registry outages must not block CI; real findings always must.
const SERVICE_ERROR_PATTERNS = [
  /\b(?:500|502|503|504)\b/u,
  /service unavailable/iu,
  /bad gateway/iu,
  /gateway timeout/iu,
  /internal server error/iu,
  /fetch failed/iu,
  /failed to fetch/iu,
  /unable to connect/iu,
  /econnrefused/iu,
  /econnreset/iu,
  /enotfound/iu,
  /etimedout/iu,
  /eai_again/iu,
  /network/iu,
  /timed out/iu,
  /connection refused/iu,
  /socket hang up/iu,
];
const FINDING_MARKERS = /vulnerabilit|advisor|severity/iu;

const runAudit = () => {
  const result = spawnSync("bun", ["audit", "--audit-level=high"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (output.trim()) {
    process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  }
  if (result.status === 0) {
    return;
  }
  // Endpoint URLs contain "advisories" and version-like numbers; classify on message text only.
  const text = output.replaceAll(/https?:\/\/\S+/gu, " ");
  const serviceError = SERVICE_ERROR_PATTERNS.some((pattern) =>
    pattern.test(text)
  );
  const reportsFindings = FINDING_MARKERS.test(text);
  if (serviceError && !reportsFindings) {
    console.warn(
      "bun audit could not reach the registry (service error) — failing open. Re-run scripts/audit.mjs manually once the registry is healthy."
    );
    return;
  }
  process.exit(result.status ?? 1);
};

runAudit();
