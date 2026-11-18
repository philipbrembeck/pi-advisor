import { describe, expect, test } from "bun:test";

import {
  isAuditProcessHealthy,
  isRegistryOutage,
  isTemporaryDevFinding,
  parseAuditFindings,
} from "../scripts/audit-policy.mjs";

const allowedFinding = {
  url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
  title:
    "picomatch vulnerable to ReDoS through single-branch repeated extglobs",
  severity: "high",
  vulnerable_versions: "<=4.0.7",
};

const asAuditJson = (report: Record<string, (typeof allowedFinding)[]>) =>
  JSON.stringify(report);

describe("dependency audit policy", () => {
  test("allows only the exact known dev-tool advisory", () => {
    const findings = parseAuditFindings(
      asAuditJson({ picomatch: [allowedFinding] })
    );

    expect(isTemporaryDevFinding(findings)).toBe(true);
  });

  test("rejects an allowed advisory combined with an unidentified finding", () => {
    expect(() =>
      parseAuditFindings(
        JSON.stringify({
          picomatch: [allowedFinding, { title: "unidentified" }],
        })
      )
    ).toThrow("Incomplete bun audit finding");
  });

  test("rejects an allowed advisory combined with malformed output", () => {
    expect(() =>
      parseAuditFindings(
        `${asAuditJson({ picomatch: [allowedFinding] })}\nnetwork error`
      )
    ).toThrow();
  });

  test("rejects unexpected advisories", () => {
    const findings = parseAuditFindings(
      asAuditJson({
        picomatch: [allowedFinding],
        other: [
          {
            ...allowedFinding,
            url: "https://github.com/advisories/GHSA-other-1234-5678",
          },
        ],
      })
    );

    expect(isTemporaryDevFinding(findings)).toBe(false);
  });

  test("does not treat a production-package finding as the dev exception", () => {
    const findings = parseAuditFindings(
      asAuditJson({
        "runtime-package": [allowedFinding],
      })
    );

    expect(isTemporaryDevFinding(findings)).toBe(false);
  });

  test("recognizes registry outages only when no finding is reported", () => {
    expect(isRegistryOutage("fetch failed: ECONNRESET")).toBe(true);
    expect(
      isRegistryOutage("fetch failed; high severity vulnerability reported")
    ).toBe(false);
    expect(
      isRegistryOutage(
        "fetch failed: https://github.com/advisories/GHSA-fc5q-39xc-vjpf"
      )
    ).toBe(false);
  });

  test("rejects processes that exit by signal", () => {
    expect(
      isAuditProcessHealthy({
        status: null,
        error: undefined,
        signal: "SIGTERM",
      })
    ).toBe(false);
  });
});
