/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: the audit intentionally enumerates each evidence boundary. */
/* biome-ignore-all lint/style/useDestructuring: field paths are deliberately explicit in machine-readable diffs. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readResults } from "./report.js";
import { isSuccessful } from "./statistics.js";
import type { BenchmarkMode, RawBenchmarkResult } from "./types.js";
import { ALL_MODES } from "./types.js";

const PROVIDER_ENV_PATTERN = /PI_(MODEL|PROVIDER|REASONING_LEVEL)$/;
const ISOLATION_ENV_PATTERN =
  /PI_(ADVISOR_BENCHMARK_RUN_ID|CODING_AGENT_DIR|SESSION_FILE|SESSION_ID)$/;

interface Difference {
  classification:
    | "accidental"
    | "intentional-and-required"
    | "potentially-performance-affecting"
    | "provider-specific-but-unavoidable";
  left: unknown;
  path: string;
  right: unknown;
}

const pairKey = (record: RawBenchmarkResult) =>
  JSON.stringify([
    record.taskId,
    record.repetition,
    record.experimentHash ?? record.provenance.benchmarkConfigHash,
    record.provenance.fixtureHash,
    record.provenance.taskHash,
  ]);
type AuditPair =
  | { key: string; status: "runtime-snapshot-unavailable" }
  | {
      differences: Difference[];
      key: string;
      left: NonNullable<RawBenchmarkResult["runtime"]>;
      right: NonNullable<RawBenchmarkResult["runtime"]>;
      status: "compared";
    };
const modelPath = (path: string) =>
  path === "requestedModel" ||
  path === "resolvedModel" ||
  path.startsWith("modelCapabilities.");
const normalizeEphemeral = (value: unknown) =>
  typeof value === "string"
    ? value
        .replace(/pi-benchmark-[^/\\s]+/g, "pi-benchmark-<run>")
        .replace(/run-[a-f0-9-]{20,}/gi, "run-<id>")
    : value;
const classify = (
  path: string,
  left: unknown,
  right: unknown
): Difference["classification"] => {
  if (normalizeEphemeral(left) === normalizeEphemeral(right)) {
    return "intentional-and-required";
  }
  if (path === "mode" || path === "profileHash") {
    return "intentional-and-required";
  }
  if (path.startsWith("advisor")) {
    return "intentional-and-required";
  }
  if (path.startsWith("environmentVariables.")) {
    const name = path.slice("environmentVariables.".length);
    if (PROVIDER_ENV_PATTERN.test(name)) {
      return "provider-specific-but-unavoidable";
    }
    if (ISOLATION_ENV_PATTERN.test(name)) {
      return "intentional-and-required";
    }
    return "potentially-performance-affecting";
  }
  if (modelPath(path)) {
    return "provider-specific-but-unavoidable";
  }
  if (
    path.includes("Prompt") ||
    path.includes("tool") ||
    path.includes("Timeout") ||
    path.includes("temperature") ||
    path.includes("reasoning") ||
    path.includes("maxOutput")
  ) {
    return "potentially-performance-affecting";
  }
  return "accidental";
};
export const canonicalRuntime = (
  runtime: NonNullable<RawBenchmarkResult["runtime"]>
) => ({
  ...runtime,
  effectiveSystemPrompt: normalizeEphemeral(runtime.effectiveSystemPrompt),
  effectiveSystemPromptHash: "<derived-from-canonical-prompt>",
  environmentVariables: Object.fromEntries(
    Object.entries(runtime.environmentVariables).map(([key, value]) => [
      key,
      normalizeEphemeral(value),
    ])
  ),
});
const diff = (left: unknown, right: unknown, path = ""): Difference[] => {
  if (Object.is(left, right)) {
    return [];
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      ? left.flatMap((value, index) =>
          diff(value, right[index], `${path}[${index}]`)
        )
      : [{ classification: classify(path, left, right), left, path, right }];
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const keys = new Set([
      ...Object.keys(left as Record<string, unknown>),
      ...Object.keys(right as Record<string, unknown>),
    ]);
    return [...keys]
      .sort()
      .flatMap((key) =>
        diff(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key
        )
      );
  }
  return [{ classification: classify(path, left, right), left, path, right }];
};
const distribution = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))]
      : null;
  let median: number | null = null;
  if (sorted.length) {
    const middle = Math.floor(sorted.length / 2);
    median =
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return { max: at(1), median, p90: at(0.9) };
};

const comparePairs = (
  grouped: Map<string, Partial<Record<BenchmarkMode, RawBenchmarkResult>>>,
  leftMode: BenchmarkMode,
  rightMode: BenchmarkMode
): AuditPair[] =>
  [...grouped.entries()].flatMap(([key, group]): AuditPair[] => {
    const left = group[leftMode];
    const right = group[rightMode];
    if (!(left && right)) {
      return [];
    }
    if (!(left.runtime && right.runtime)) {
      return [{ key, status: "runtime-snapshot-unavailable" }];
    }
    return [
      {
        differences: diff(
          canonicalRuntime(left.runtime),
          canonicalRuntime(right.runtime)
        ),
        key,
        left: left.runtime,
        right: right.runtime,
        status: "compared",
      },
    ];
  });

export const buildAudit = (
  records: RawBenchmarkResult[],
  inputPath: string
) => {
  const grouped = new Map<
    string,
    Partial<Record<BenchmarkMode, RawBenchmarkResult>>
  >();
  for (const record of records) {
    const group = grouped.get(pairKey(record)) ?? {};
    group[record.mode] = record;
    grouped.set(pairKey(record), group);
  }
  const baselinePairs = comparePairs(grouped, "baseline", "small-baseline");
  const advisorPairs = comparePairs(grouped, "small-baseline", "advisor");
  const transitions = {
    advisorFailScoutPass: 0,
    advisorPassScoutFail: 0,
    lunaFailAdvisorPass: 0,
    lunaPassAdvisorFail: 0,
  };
  const trajectoryComparisons: Array<{
    advisor: { correct: boolean; diagnostics: unknown[]; events: unknown[] };
    advisorScout?: {
      correct: boolean;
      diagnostics: unknown[];
      events: unknown[];
    };
    key: string;
    smallBaseline: {
      correct: boolean;
      diagnostics: unknown[];
      events: unknown[];
    };
    validation: Record<string, unknown>;
  }> = [];
  for (const [key, group] of grouped.entries()) {
    const luna = group["small-baseline"];
    const advisor = group.advisor;
    const scout = group["advisor-scout"];
    if (luna && advisor) {
      const lunaPassed = isSuccessful(luna);
      const advisorPassed = isSuccessful(advisor);
      if (!lunaPassed && advisorPassed) {
        transitions.lunaFailAdvisorPass += 1;
      }
      if (lunaPassed && !advisorPassed) {
        transitions.lunaPassAdvisorFail += 1;
      }
    }
    if (advisor && scout) {
      if (!isSuccessful(advisor) && isSuccessful(scout)) {
        transitions.advisorFailScoutPass += 1;
      }
      if (isSuccessful(advisor) && !isSuccessful(scout)) {
        transitions.advisorPassScoutFail += 1;
      }
    }
    if (luna && advisor) {
      trajectoryComparisons.push({
        advisor: {
          correct: isSuccessful(advisor),
          diagnostics: advisor.advisor.diagnostics ?? [],
          events: advisor.trajectoryEvents ?? [],
        },
        ...(scout
          ? {
              advisorScout: {
                correct: isSuccessful(scout),
                diagnostics: scout.advisor.diagnostics ?? [],
                events: scout.trajectoryEvents ?? [],
              },
            }
          : {}),
        key,
        smallBaseline: {
          correct: isSuccessful(luna),
          diagnostics: luna.advisor.diagnostics ?? [],
          events: luna.trajectoryEvents ?? [],
        },
        validation: {
          advisor: advisor.validation,
          advisorScout: scout?.validation,
          smallBaseline: luna.validation,
        },
      });
    }
  }
  const timeout = Object.fromEntries(
    ALL_MODES.map((mode) => {
      const modeRecords = records.filter((record) => record.mode === mode);
      const completed = modeRecords
        .filter(
          (record) =>
            record.termination.state === "settled" && record.durationMs > 0
        )
        .map((record) => record.durationMs);
      return [
        mode,
        {
          attempts: modeRecords.length,
          completed: completed.length,
          completedDurationMs: distribution(completed),
          timeoutRate: modeRecords.length
            ? modeRecords.filter(
                (record) => record.termination.state === "timeout"
              ).length / modeRecords.length
            : 0,
          timeouts: modeRecords.filter(
            (record) => record.termination.state === "timeout"
          ).length,
        },
      ];
    })
  );
  return {
    advisorEquivalence: {
      compared: advisorPairs.filter((pair) => pair.status === "compared")
        .length,
      pairs: advisorPairs,
      unavailable: advisorPairs.filter((pair) => pair.status !== "compared")
        .length,
    },
    baselineEquivalence: {
      compared: baselinePairs.filter((pair) => pair.status === "compared")
        .length,
      pairs: baselinePairs,
      unavailable: baselinePairs.filter((pair) => pair.status !== "compared")
        .length,
    },
    generatedAt: new Date().toISOString(),
    inputPath: resolve(inputPath),
    limitations: [
      "Existing records without runtime snapshots cannot establish effective-prompt or tool-definition equivalence.",
      "Retrospective records use the historical forced pre-edit Advisor prompt; they do not validate corrected optional/mandatory modes.",
      "No independent sanity-suite tasks were added or run in this audit.",
    ],
    modesPresent: ALL_MODES.filter((mode) =>
      records.some((record) => record.mode === mode)
    ),
    records: records.length,
    timeout,
    trajectoryComparisons,
    transitions,
  };
};

export const renderAuditMarkdown = (audit: ReturnType<typeof buildAudit>) => {
  const compared = audit.baselineEquivalence.pairs.filter(
    (pair): pair is Extract<AuditPair, { status: "compared" }> =>
      pair.status === "compared"
  );
  const differences = compared.flatMap((pair) => pair.differences);
  const counts = new Map<string, number>();
  const classifications = new Map<string, number>();
  for (const difference of differences) {
    counts.set(difference.path, (counts.get(difference.path) ?? 0) + 1);
    classifications.set(
      difference.classification,
      (classifications.get(difference.classification) ?? 0) + 1
    );
  }
  const trajectoryWithEvents = audit.trajectoryComparisons.filter(
    (pair) => pair.smallBaseline.events.length || pair.advisor.events.length
  ).length;
  return `# Benchmark Harness Audit\n\nGenerated ${audit.generatedAt}. Source: \`${audit.inputPath}\`.\n\n## Evidence limits\n\n${audit.limitations.map((item) => `- ${item}`).join("\n")}\n\n## Baseline equivalence\n\n- Pairs with runtime snapshots: ${compared.length}\n- Pairs without snapshots: ${audit.baselineEquivalence.unavailable}\n- Exact differing fields: ${differences.length ? [...counts.entries()].map(([path, count]) => `\`${path}\` (${count})`).join(", ") : "none"}\n- Difference classifications: ${classifications.size ? [...classifications.entries()].map(([classification, count]) => `${classification} (${count})`).join(", ") : "none"}\n- Luna vs Luna + Advisor runtime pairs: ${audit.advisorEquivalence.compared} compared; ${audit.advisorEquivalence.unavailable} unavailable.\n\nThe machine-readable JSON contains both exact snapshots and classified field diffs. A missing snapshot is not treated as equivalence. Advisor equivalence is reported separately as Luna baseline vs Luna + Advisor.\n\n## Paired transitions\n\n- Luna fail → Advisor pass: ${audit.transitions.lunaFailAdvisorPass}\n- Luna pass → Advisor fail: ${audit.transitions.lunaPassAdvisorFail}\n- Advisor fail → Scout pass: ${audit.transitions.advisorFailScoutPass}\n- Advisor pass → Scout fail: ${audit.transitions.advisorPassScoutFail}\n- Paired trajectory records: ${audit.trajectoryComparisons.length}; with observable event timelines: ${trajectoryWithEvents}\n\n## Timeout fairness\n\n| Mode | Attempts | Timeouts | Timeout rate | Completed median | Completed p90 | Completed max |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${Object.entries(
    audit.timeout
  )
    .map(
      ([mode, value]) =>
        `| ${mode} | ${value.attempts} | ${value.timeouts} | ${(value.timeoutRate * 100).toFixed(1)}% | ${value.completedDurationMs.median ?? "N/A"} ms | ${value.completedDurationMs.p90 ?? "N/A"} ms | ${value.completedDurationMs.max ?? "N/A"} ms |`
    )
    .join("\n")}\n`;
};

export const writeAudit = (
  audit: ReturnType<typeof buildAudit>,
  markdownPath: string,
  jsonPath: string
) => {
  writeFileSync(markdownPath, `${renderAuditMarkdown(audit)}\n`);
  writeFileSync(jsonPath, `${JSON.stringify(audit, null, 2)}\n`);
};

if (import.meta.main) {
  const [, , input] = process.argv;
  if (!input) {
    throw new Error(
      "Usage: bun benchmarks/src/audit.ts <results.jsonl> [json] [markdown]"
    );
  }
  const audit = buildAudit(readResults(input), input);
  writeAudit(
    audit,
    process.argv[4] ?? `${input}.audit.md`,
    process.argv[3] ?? `${input}.audit.json`
  );
}
