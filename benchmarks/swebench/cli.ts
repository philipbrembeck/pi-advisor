import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadManifest } from "./adapter.js";
import {
  assertPreflight,
  readSwebenchResults,
  renderPreflight,
  runControl,
  runPreflight,
  runRuntimeProbe,
} from "./runner.js";

const value = (args: string[], flag: string, fallback?: string) => {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1];
};
const option = (args: string[], flag: string, fallback: string) =>
  value(args, flag, fallback) ?? fallback;
const has = (args: string[], flag: string) => args.includes(flag);
const writeJson = (path: string, valueToWrite: unknown) => {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), `${JSON.stringify(valueToWrite, null, 2)}\n`);
};

const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0] ?? "preflight";
  const manifestPath = option(
    args,
    "--manifest",
    command === "baseline-v2" ||
      command === "optional-advisor-v1" ||
      command === "optional-advisor-replication"
      ? "benchmarks/swebench/hard-baseline-v2-manifest.json"
      : "benchmarks/swebench/control-manifest.json"
  );
  if (command === "optional-advisor-v1") {
    const { executeOptionalAdvisorV1 } = await import(
      "./optional-advisor-v1.js"
    );
    const { writeOptionalAdvisorReport } = await import(
      "./optional-advisor-report.js"
    );
    const run = await executeOptionalAdvisorV1({
      concurrency: Number(value(args, "--concurrency", "4")),
      experimentId: value(args, "--experiment"),
      timeoutSeconds: Number(value(args, "--timeout", "600")),
      validatorTimeoutSeconds: Number(
        value(args, "--validator-timeout", "300")
      ),
    });
    writeOptionalAdvisorReport(
      run.records,
      run.proof,
      run.provenance,
      run.resultsPath,
      run.reportPath
    );
    console.log(`Completed ${run.records.length} optional-Advisor executions.`);
    return;
  }
  if (command === "optional-advisor-replication") {
    const { executeOptionalAdvisorReplication } = await import(
      "./optional-advisor-replication.js"
    );
    const { writeOptionalAdvisorReplicationReport } = await import(
      "./optional-advisor-replication-report.js"
    );
    const run = await executeOptionalAdvisorReplication({
      concurrency: Number(value(args, "--concurrency", "4")),
      experimentId: value(args, "--experiment"),
      timeoutSeconds: Number(value(args, "--timeout", "600")),
      validatorTimeoutSeconds: Number(
        value(args, "--validator-timeout", "300")
      ),
    });
    writeOptionalAdvisorReplicationReport(
      run.records,
      run.schedule,
      run.provenance,
      run.resultsPath,
      run.reportPath
    );
    console.log(
      `Completed ${run.records.length} randomized paired executions.`
    );
    return;
  }
  if (command === "baseline-v2") {
    const { executeBaselineV2 } = await import("./baseline-v2.js");
    const { writeBaselineReport } = await import("./baseline-report.js");
    const run = await executeBaselineV2({
      artifactsRoot: option(
        args,
        "--artifacts",
        "benchmarks/swebench/artifacts"
      ),
      cacheRoot: option(args, "--cache", "benchmarks/swebench/cache"),
      concurrency: Number(value(args, "--concurrency", "4")),
      configPath: option(
        args,
        "--config",
        "benchmarks/config/benchmark.local.json"
      ),
      experimentId: value(args, "--experiment"),
      manifestPath,
      reportPath: option(
        args,
        "--report",
        "benchmarks/SWEBENCH-HARD-BASELINE-V2-REPORT.md"
      ),
      resultsRoot: option(
        args,
        "--results-root",
        "benchmarks/swebench/results"
      ),
      timeoutSeconds: Number(value(args, "--timeout", "600")),
      validatorTimeoutSeconds: Number(
        value(args, "--validator-timeout", "300")
      ),
    });
    writeBaselineReport(
      run.records,
      loadManifest(manifestPath),
      run.provenance,
      run.resultsPath,
      run.reportPath
    );
    console.log(`Completed ${run.records.length} frozen Sol/Luna executions.`);
    return;
  }
  if (command === "construct") {
    await import("./hard-baseline-builder.js");
    return;
  }
  if (command === "construct-v2") {
    await import("./hard-baseline-v2-builder.js");
    return;
  }
  const manifest = loadManifest(manifestPath);
  const cacheRoot = option(args, "--cache", "benchmarks/swebench/cache");
  const configPath = option(
    args,
    "--config",
    "benchmarks/config/benchmark.local.json"
  );
  const timeoutSeconds = Number(value(args, "--timeout", "600"));
  const validatorTimeoutSeconds = Number(
    value(args, "--validator-timeout", "300")
  );
  if (command === "preflight") {
    const rows = await runPreflight(
      manifest,
      cacheRoot,
      validatorTimeoutSeconds
    );
    const reportPath = option(
      args,
      "--report",
      "benchmarks/swebench/artifacts/exp-20260818-swebench-control-v2-preflight.json"
    );
    writeJson(reportPath, { experimentId: manifest.experimentId, rows });
    console.log(renderPreflight(rows));
    assertPreflight(rows);
    return;
  }
  if (command === "probe") {
    const probe = await runRuntimeProbe({
      cacheRoot,
      configPath,
      manifest,
      timeoutSeconds,
    });
    const reportPath = option(
      args,
      "--report",
      "benchmarks/swebench/artifacts/exp-20260818-swebench-control-v2-runtime-probe.json"
    );
    writeJson(reportPath, probe);
    console.log(JSON.stringify(probe, null, 2));
    return;
  }
  if (command === "run") {
    const resultsPath = option(
      args,
      "--results",
      "benchmarks/swebench/results/exp-20260818-swebench-control-v2.jsonl"
    );
    const records = await runControl({
      artifactsRoot: value(
        args,
        "--artifacts",
        "benchmarks/swebench/artifacts"
      ),
      cacheRoot,
      concurrency: Number(value(args, "--concurrency", "4")),
      configPath,
      manifest,
      resultsPath: resolve(resultsPath),
      timeoutSeconds,
      validatorTimeoutSeconds,
    });
    console.log(`Completed ${records.length} fresh SWE-bench executions.`);
    return;
  }
  if (command === "report") {
    const input = value(args, "--input");
    if (!input) {
      throw new Error("report requires --input <results.jsonl>");
    }
    const records = readSwebenchResults(input);
    const reportPath = option(
      args,
      "--report",
      "benchmarks/SWEBENCH-CONTROL-V2-REPORT.md"
    );
    const { renderSwebenchReport } = await import("./report.js");
    writeFileSync(
      resolve(reportPath),
      renderSwebenchReport(records, resolve(input))
    );
    console.log(`Report written to ${reportPath}`);
    return;
  }
  if (has(args, "--help")) {
    console.log(
      "Usage: bun benchmarks/swebench/cli.ts <construct|construct-v2|baseline-v2|optional-advisor-v1|optional-advisor-replication|preflight|probe|run|report> [options]"
    );
    return;
  }
  throw new Error(`Unknown SWE-bench command: ${command}`);
};
main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
