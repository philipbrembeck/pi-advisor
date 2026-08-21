/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: the CLI parser keeps all supported flags in one auditable dispatch. */
/* biome-ignore-all lint/suspicious/noShadow: report and run result names are intentionally local to their command branches. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runBenchmark } from "./orchestrator.js";
import { buildReport, readResults, writeReport } from "./report.js";
import {
  ALL_MODES,
  type BenchmarkCategory,
  type BenchmarkMode,
  CATEGORIES,
} from "./types.js";

interface Args {
  category?: BenchmarkCategory;
  command: "run" | "report";
  concurrency?: number;
  config: string;
  input?: string;
  json?: string;
  markdown?: string;
  mock?: boolean;
  modes?: BenchmarkMode[];
  progressIntervalSeconds?: number;
  results?: string;
  runs?: number;
  seed?: number;
  taskIds?: string[];
  tasks: string;
}

export const parseArgs = (argv: string[]): Args => {
  const command = argv[0] === "report" ? "report" : "run";
  const parsed: Args = {
    command,
    config: "benchmarks/config/benchmark.example.json",
    tasks: "benchmarks/tasks",
  };
  let index = command === "report" ? 1 : 0;
  const next = (name: string) => {
    index += 1;
    const value = argv[index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    return value;
  };
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === "--config") {
      parsed.config = next(arg);
    } else if (arg === "--concurrency") {
      parsed.concurrency = Number(next(arg));
    } else if (arg === "--tasks") {
      parsed.tasks = next(arg);
    } else if (arg === "--task") {
      parsed.taskIds = next(arg).split(",");
    } else if (arg === "--mode") {
      const modes = next(arg).split(",") as BenchmarkMode[];
      if (
        modes.length === 0 ||
        modes.some((mode) => !ALL_MODES.includes(mode))
      ) {
        throw new Error(`Unknown mode: ${modes.join(",")}`);
      }
      parsed.modes = modes;
    } else if (arg === "--category") {
      const category = next(arg) as BenchmarkCategory;
      if (!CATEGORIES.includes(category)) {
        throw new Error(`Unknown category: ${category}`);
      }
      parsed.category = category;
    } else if (arg === "--progress-interval") {
      parsed.progressIntervalSeconds = Number(next(arg));
    } else if (arg === "--runs") {
      parsed.runs = Number(next(arg));
    } else if (arg === "--seed") {
      parsed.seed = Number(next(arg));
    } else if (arg === "--results") {
      parsed.results = next(arg);
    } else if (arg === "--input") {
      parsed.input = next(arg);
    } else if (arg === "--markdown") {
      parsed.markdown = next(arg);
    } else if (arg === "--json") {
      parsed.json = next(arg);
    } else if (arg === "--mock") {
      parsed.mock = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
    index += 1;
  }
  if (
    parsed.concurrency !== undefined &&
    (!Number.isSafeInteger(parsed.concurrency) || parsed.concurrency <= 0)
  ) {
    throw new Error("--concurrency must be a positive integer.");
  }
  if (
    parsed.runs !== undefined &&
    (!Number.isSafeInteger(parsed.runs) || parsed.runs <= 0)
  ) {
    throw new Error("--runs must be a positive integer.");
  }
  if (
    parsed.seed !== undefined &&
    (!Number.isSafeInteger(parsed.seed) || parsed.seed < 0)
  ) {
    throw new Error("--seed must be a non-negative integer.");
  }
  if (
    parsed.progressIntervalSeconds !== undefined &&
    (!Number.isFinite(parsed.progressIntervalSeconds) ||
      parsed.progressIntervalSeconds <= 0)
  ) {
    throw new Error("--progress-interval must be positive seconds.");
  }
  return parsed;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "report") {
    if (!args.input) {
      throw new Error("report requires --input <results.jsonl>.");
    }
    const results = readResults(args.input);
    const report = buildReport(
      results,
      resolve(args.input),
      args.seed ?? 1,
      args.runs ??
        Math.max(1, ...results.map((result) => result.repetition + 1))
    );
    const markdown = args.markdown ?? `${args.input}.md`;
    const json = args.json ?? `${args.input}.json`;
    writeReport(report, markdown, json);
    process.stdout.write(`Report written to ${markdown} and ${json}\n`);
    return;
  }
  if (!existsSync(args.config)) {
    throw new Error(`Config not found: ${args.config}`);
  }
  const result = await runBenchmark({
    category: args.category,
    concurrency: args.concurrency,
    configPath: args.config,
    mock: args.mock,
    modes: args.modes,
    progressIntervalSeconds: args.progressIntervalSeconds,
    resultsPath: args.results,
    runs: args.runs,
    seed: args.seed,
    taskIds: args.taskIds,
    tasksPath: args.tasks,
  });
  process.stdout.write(
    `Completed ${result.records.length} runs; results appended to ${result.path}\n`
  );
};
main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
