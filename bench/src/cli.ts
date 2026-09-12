import { resolve } from "node:path";
import { DEFAULT_CONFIG, loadBenchmarkConfig } from "./config.ts";
import { defaultControlAdvice, runControls } from "./controls.ts";
import { runDecisions as runDecisionBenchmark } from "./decisions.ts";
import { runEvaluation } from "./evaluate-runner.ts";
import { hashTree } from "./fixture.ts";
import { runReplay } from "./replay/runner.ts";
import { reportFor, writeReport } from "./report.ts";
import { runScreening } from "./screen.ts";
import type { BenchmarkReport, BenchmarkTier } from "./types.ts";

const help = () => `Usage: bun bench/src/cli.ts <command> [options]

Commands:
  replay      Run the offline Tier 1 replay and controls
  decisions   Run Tier 2 decisions (offline controls or BENCH_LIVE=1 scoring)
  screen      Run Tier 3 Stage 1 screening (requires BENCH_LIVE=1)
  evaluate    Run Tier 3 Stage 2 evaluation (requires BENCH_LIVE=1)

Options:
  --config <path>  Use a benchmark JSON configuration
  --no-report      Do not write a report
  --help           Show this help
`;

const option = (args: string[], name: string) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};

const has = (args: string[], name: string) => args.includes(name);

const unavailableTier = (
  tier: BenchmarkTier,
  config = DEFAULT_CONFIG,
  reason = `Tier ${tier} is live-only. Set BENCH_LIVE=1 after provider, ReactBench, and preregistration checks are ready.`
) => {
  const controlRun = runControls(
    resolve(config.fixtureRoot, "controls"),
    defaultControlAdvice
  );
  const report = reportFor(
    tier,
    config,
    {
      controlSource: "deterministic fixture controls only",
      controls: controlRun.scores,
      live: false,
    },
    {
      controls: controlRun.controls,
      fixtureHashes: {
        controls: hashTree(resolve(config.fixtureRoot, "controls")),
      },
      status: "UNAVAILABLE",
      warnings: [reason],
    }
  );
  writeReport(report, undefined, config.reportRoot);
  return report;
};

/* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the CLI keeps each tier's fail-closed exit policy explicit. */
export const main = async (argv = process.argv.slice(2)) => {
  const [command] = argv;
  if (!command || command === "--help" || has(argv, "--help")) {
    console.log(help());
    return;
  }
  const { config } = loadBenchmarkConfig(option(argv, "--config"));
  if (command === "replay") {
    const report = await runReplay({
      config,
      writeReportOutput: !has(argv, "--no-report"),
    });
    console.log(`Tier 1 replay: ${report.status}`);
    if (report.status !== "PASS") {
      process.exitCode = report.status === "UNAVAILABLE" ? 2 : 1;
    }
    return;
  }
  if (command === "decisions") {
    let report: BenchmarkReport;
    try {
      report = await runDecisionBenchmark({
        config,
        live: process.env.BENCH_LIVE === "1",
        writeReportOutput: !has(argv, "--no-report"),
      });
    } catch (error) {
      report = unavailableTier(
        "decisions",
        config,
        `Tier decisions failed closed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    console.log(`Tier 2 decisions: ${report.status}`);
    if (report.status !== "PASS") {
      process.exitCode = report.status === "UNAVAILABLE" ? 2 : 1;
    }
    return;
  }
  if (command === "screen" || command === "evaluate") {
    if (process.env.BENCH_LIVE !== "1") {
      const report = unavailableTier(command, config);
      console.error(`Tier ${command}: ${report.status}`);
      process.exitCode = 2;
      return;
    }
    let report: BenchmarkReport;
    try {
      report =
        command === "screen"
          ? await runScreening({
              config,
              writeReportOutput: !has(argv, "--no-report"),
            })
          : await runEvaluation({
              config,
              writeReportOutput: !has(argv, "--no-report"),
            });
    } catch (error) {
      report = unavailableTier(
        command,
        config,
        `Tier ${command} failed closed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    console.log(`Tier ${command}: ${report.status}`);
    if (report.status !== "PASS") {
      process.exitCode = report.status === "UNAVAILABLE" ? 2 : 1;
    }
    return;
  }
  throw new Error(`Unknown benchmark command: ${command}`);
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
