import { spawnSync } from "node:child_process";

import {
  isAuditProcessHealthy,
  isRegistryOutage,
  isTemporaryDevFinding,
  parseAuditFindings,
} from "./audit-policy.mjs";

const runAudit = (args) => {
  const result = spawnSync("bun", ["audit", "--json", ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    error: result.error,
    signal: result.signal,
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
};

const exitOnFailure = (result) =>
  process.exit(result.status === 0 ? 1 : (result.status ?? 1));

const runAuditChecks = () => {
  const production = runAudit(["--production", "--audit-level=high"]);

  if (!isAuditProcessHealthy(production)) {
    exitOnFailure(production);
  }

  let productionFindings;

  try {
    productionFindings = parseAuditFindings(production.stdout);
  } catch {
    if (isRegistryOutage(`${production.stdout}\n${production.stderr}`)) {
      console.warn(
        "bun audit could not reach the registry (service error) — failing open. Re-run scripts/audit.mjs manually once the registry is healthy."
      );

      return;
    }

    throw new Error("Could not validate production audit output.");
  }

  if (productionFindings.length > 0 || production.status !== 0) {
    console.error("Production dependency audit failed.");
    exitOnFailure(production);
  }

  const allDependencies = runAudit(["--audit-level=high"]);

  if (!isAuditProcessHealthy(allDependencies)) {
    exitOnFailure(allDependencies);
  }

  let findings;

  try {
    findings = parseAuditFindings(allDependencies.stdout);
  } catch {
    if (
      isRegistryOutage(`${allDependencies.stdout}\n${allDependencies.stderr}`)
    ) {
      console.warn(
        "bun audit could not reach the registry (service error) — failing open. Re-run scripts/audit.mjs manually once the registry is healthy."
      );

      return;
    }

    throw new Error("Could not validate full dependency audit output.");
  }

  if (allDependencies.status === 0 && findings.length === 0) {
    return;
  }

  if (allDependencies.status !== 0 && isTemporaryDevFinding(findings)) {
    console.warn(
      `Temporary dev-tool audit exception: ${JSON.stringify(findings)}. Production dependency audit passed; remove this exception when upstream publishes a fix.`
    );

    return;
  }

  console.error("Full dependency audit failed.");
  exitOnFailure(allDependencies);
};

runAuditChecks();
