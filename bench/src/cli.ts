import { resolve } from "node:path";
import { defaultControlAdvice, runControls } from "./controls.js";
import { DEFAULT_CONFIG, loadBenchmarkConfig } from "./config.js";
import { reportFor, writeReport } from "./report.js";
import { runReplay } from "./replay/runner.js";
import type { BenchmarkTier } from "./types.js";

const help = () => `Usage: bun bench/src/cli.ts <command> [options]

Commands:
  replay      Run the offline Tier 1 replay and controls
  decisions   Run the deterministic controls (live scoring requires BENCH_LIVE=1)
  screen      Run Tier 3 Stage 1 screening (requires BENCH_LIVE=1)
  evaluate    Run Tier 3 Stage 2 evaluation (requires BENCH_LIVE=1)

Options:
  --config <path>  Use a benchmark JSON configuration
  --no-report      Do not write a report (replay only)
  --help           Show this help
`;

const option = (args: string[], name: string) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};

const has = (args: string[], name: string) => args.includes(name);

const unavailableTier = (tier: BenchmarkTier, config = DEFAULT_CONFIG) => {
  const report = reportFor(
    tier,
    config,
    { live: false },
    {
      status: "UNAVAILABLE",
      warnings: [
        `Tier ${tier} is live-only. Set BENCH_LIVE=1 after provider, ReactBench, and preregistration checks are ready.`,
      ],
    }
  );
  writeReport(report);
  return report;
};

const runDecisions = (config = DEFAULT_CONFIG) => {
  const controls = runControls(
    resolve(config.fixtureRoot, "controls"),
    defaultControlAdvice
  );
  const status = controls.controls.invalid ? "INVALID" : "PASS";
  const report = reportFor(
    "decisions",
    config,
    { controls: controls.scores, itemCount: controls.scores.length / 2 },
    { controls: controls.controls, status }
  );
  writeReport(report);
  return report;
};

export const main = async (argv = process.argv.slice(2)) => {
  const [command] = argv;
  if (!command || command === "--help" || has(argv, "--help")) {
    console.log(help());
    return;
  }
  const loaded = loadBenchmarkConfig(option(argv, "--config"));
  const config = loaded.config;
  if (command === "replay") {
    const report = await runReplay({ config, report: !has(argv, "--no-report") });
    console.log(`Tier 1 replay: ${report.status}`);
    return;
  }
  if (command === "decisions") {
    const report =
      process.env.BENCH_LIVE === "1"
        ? runDecisions(config)
        : runDecisions(config);
    console.log(`Tier 2 controls: ${report.status}`);
    return;
  }
  if (command === "screen" || command === "evaluate") {
    if (process.env.BENCH_LIVE !== "1") {
      const report = unavailableTier(command, config);
      console.error(`Tier ${command}: ${report.status}`);
      process.exitCode = 2;
      return;
    }
    throw new Error(
      `Tier ${command} live runner is not enabled until the ReactBench adapter and preregistration are present.`
    );
  }
  throw new Error(`Unknown benchmark command: ${command}`);
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
