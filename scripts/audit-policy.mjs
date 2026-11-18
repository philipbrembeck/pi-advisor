/* oxlint-disable anti-slop/no-runtime-typeof -- validate untrusted audit output. */
const TEMPORARY_DEV_ADVISORY = {
  package: "picomatch",
  url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
  title:
    "picomatch vulnerable to ReDoS through single-branch repeated extglobs",
  severity: "high",
  vulnerableVersions: "<=4.0.7",
};

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

export const parseAuditFindings = (output) => {
  const report = JSON.parse(output);

  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new TypeError("Unexpected bun audit JSON report.");
  }

  const findings = [];

  for (const [packageName, advisories] of Object.entries(report)) {
    if (!Array.isArray(advisories)) {
      throw new TypeError("Unexpected bun audit JSON report.");
    }

    for (const advisory of advisories) {
      if (
        !advisory ||
        typeof advisory !== "object" ||
        typeof advisory.url !== "string" ||
        typeof advisory.title !== "string" ||
        typeof advisory.severity !== "string" ||
        typeof advisory.vulnerable_versions !== "string"
      ) {
        throw new TypeError("Incomplete bun audit finding.");
      }

      findings.push({ packageName, ...advisory });
    }
  }

  return findings;
};

export const isTemporaryDevFinding = (findings) =>
  findings.length === 1 &&
  findings[0].packageName === TEMPORARY_DEV_ADVISORY.package &&
  findings[0].url === TEMPORARY_DEV_ADVISORY.url &&
  findings[0].title === TEMPORARY_DEV_ADVISORY.title &&
  findings[0].severity === TEMPORARY_DEV_ADVISORY.severity &&
  findings[0].vulnerable_versions === TEMPORARY_DEV_ADVISORY.vulnerableVersions;

export const isRegistryOutage = (output) => {
  const hasAdvisoryId = /(?:GHSA-[a-z0-9-]+|CVE-\d{4}-\d+)/iu.test(output);
  const text = output.replaceAll(/https?:\/\/\S+/gu, " ");

  return (
    !hasAdvisoryId &&
    !FINDING_MARKERS.test(text) &&
    SERVICE_ERROR_PATTERNS.some((pattern) => pattern.test(text))
  );
};

export const isAuditProcessHealthy = ({ status, error, signal }) =>
  typeof status === "number" && !error && !signal;
