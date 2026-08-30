import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { capturePins } from "./pins.js";
import type {
  BenchmarkConfig,
  BenchmarkPins,
  BenchmarkReport,
  BudgetEstimate,
} from "./types.js";
import { BENCHMARK_SCHEMA_VERSION } from "./types.js";

export const reportFor = (
  tier: BenchmarkReport["tier"],
  config: BenchmarkConfig,
  metrics: Record<string, unknown>,
  options: {
    budget?: BudgetEstimate;
    controls?: BenchmarkReport["controls"];
    fixtureHashes?: Record<string, string>;
    gateSettings?: Record<string, unknown>;
    generatedAt?: string;
    status?: BenchmarkReport["status"];
    warnings?: string[];
  } = {}
): BenchmarkReport => ({
  ...(options.budget ? { budget: options.budget } : {}),
  ...(options.controls ? { controls: options.controls } : {}),
  generatedAt: options.generatedAt ?? new Date().toISOString(),
  metrics,
  pins: capturePins(config, options.fixtureHashes, options.gateSettings),
  schemaVersion: BENCHMARK_SCHEMA_VERSION,
  status: options.status ?? "PASS",
  tier,
  warnings: options.warnings ?? [],
});

export const reportFileStem = (report: BenchmarkReport) =>
  `${report.generatedAt.replace(/[:.]/g, "-")}-${report.tier}`;

export const reportPaths = (
  report: BenchmarkReport,
  reportRoot: string
): { json: string; markdown: string } => {
  const root = resolve(reportRoot);
  const stem = reportFileStem(report);
  return {
    json: join(root, `${stem}.json`),
    markdown: join(root, `${stem}.md`),
  };
};

const jsonValue = (value: unknown) =>
  value === undefined ? "unavailable" : JSON.stringify(value);

const renderPins = (pins: BenchmarkPins) => {
  const models = Object.entries(pins.modelPins)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, pin]) => `- ${name}: ${pin.role} ${pin.model} @ ${pin.effort}`)
    .join("\n");
  return [
    `- pi-advisor: ${pins.advisorVersion}`,
    `- Pi: ${pins.piVersion}`,
    `- ReactBench commit: ${pins.reactBenchCommit}`,
    `- React Doctor: ${pins.reactDoctorVersion}`,
    "- Model pins:",
    models || "  - unavailable",
    `- Fixture hashes: ${Object.keys(pins.fixtureHashes).length}`,
    `- Gate settings: ${JSON.stringify(pins.gateSettings)}`,
  ].join("\n");
};

const renderMetrics = (metrics: Record<string, unknown>) => {
  const entries = Object.entries(metrics).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (entries.length === 0) {
    return "No metrics recorded.";
  }
  return entries
    .map(([key, value]) => `- **${key}:** ${jsonValue(value)}`)
    .join("\n");
};

const renderPlots = (metrics: Record<string, unknown>) => {
  if (!metrics.plots || typeof metrics.plots !== "object") {
    return "No plots recorded.";
  }
  const plots = Object.entries(metrics.plots as Record<string, unknown>)
    .filter(
      ([, value]) => typeof value === "string" && value.startsWith("<svg")
    )
    .sort(([left], [right]) => left.localeCompare(right));
  return plots.length
    ? plots.map(([name, value]) => `### ${name}\n\n${value}`).join("\n\n")
    : "No plots recorded.";
};

export const renderReportMarkdown = (report: BenchmarkReport) => {
  const controls = report.controls
    ? [
        `- null catch rate: ${report.controls.nullCatchRate}`,
        `- oracle catch rate: ${report.controls.oracleCatchRate}`,
        `- oracle false-alarm rate: ${report.controls.oracleFalseAlarmRate}`,
        `- validity: ${report.controls.invalid ? "INVALID" : "valid"}`,
      ].join("\n")
    : "Not run.";
  const warnings = report.warnings.length
    ? report.warnings.map((warning) => `- ${warning}`).join("\n")
    : "None.";
  return [
    `# pi-advisor benchmark report: ${report.tier}`,
    "",
    `Status: **${report.status}**  `,
    `Generated: ${report.generatedAt}`,
    "",
    "## Pins",
    "",
    renderPins(report.pins),
    "",
    "## Controls",
    "",
    controls,
    "",
    "## Metrics",
    "",
    renderMetrics(report.metrics),
    "",
    "## Budget",
    "",
    report.budget
      ? `Estimated/reserved: $${report.budget.estimatedUsd.toFixed(4)} / $${report.budget.capUsd.toFixed(4)}; calls ${report.budget.expectedCalls}/${report.budget.maxCalls}.`
      : "Not applicable.",
    "",
    "## Plots",
    "",
    renderPlots(report.metrics),
    "",
    "## Warnings",
    "",
    warnings,
    "",
  ].join("\n");
};

export const writeReport = (
  report: BenchmarkReport,
  paths?: { json: string; markdown: string },
  reportRoot = "bench/reports"
) => {
  const output = paths ?? reportPaths(report, reportRoot);
  mkdirSync(dirname(output.json), { recursive: true });
  mkdirSync(dirname(output.markdown), { recursive: true });
  writeFileSync(output.json, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(output.markdown, renderReportMarkdown(report));
  return output;
};

export const readReport = (path: string): BenchmarkReport => {
  const value = JSON.parse(
    readFileSync(resolve(path), "utf8")
  ) as Partial<BenchmarkReport>;
  if (value.schemaVersion !== BENCHMARK_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported benchmark report schema in ${basename(path)}: ${String(value.schemaVersion)}`
    );
  }
  if (
    (value.status !== "PASS" &&
      value.status !== "INVALID" &&
      value.status !== "UNAVAILABLE") ||
    typeof value.generatedAt !== "string" ||
    typeof value.tier !== "string" ||
    !value.pins ||
    !value.metrics
  ) {
    throw new TypeError(`Malformed benchmark report: ${path}`);
  }
  return value as BenchmarkReport;
};
