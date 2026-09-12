import {
  CommandReactBenchRunner,
  type CommandReactBenchRunnerOptions,
  type ReactBenchTrialRequest,
  type ReactBenchTrialResult,
  type ReactBenchTrialRunner,
} from "./reactbench.ts";

/**
 * The adapter protocol used by the Harbor task container (or the approved
 * outside-Harbor fallback) is intentionally tiny: run one isolated Pi trial
 * and print one `BENCH_RESULT=<json>` line. The grader remains ReactBench's
 * verifier; this class does not interpret reward files or report scores.
 */
export class PiReactBenchAdapter implements ReactBenchTrialRunner {
  readonly #runner: CommandReactBenchRunner;

  constructor(options: CommandReactBenchRunnerOptions) {
    this.#runner = new CommandReactBenchRunner(options);
  }

  run = (request: ReactBenchTrialRequest): Promise<ReactBenchTrialResult> =>
    this.#runner.run(request);
}

export const createPiReactBenchAdapter = (
  command = process.env.BENCH_PI_ADAPTER
) => {
  if (!command?.trim()) {
    return;
  }
  return new PiReactBenchAdapter({
    artifactRoot: "bench/reports/reactbench-trajectories",
    command,
    cwd: process.cwd(),
  });
};

export const piAdapterProtocol = {
  requiredRequestFields: [
    "task",
    "seed",
    "arm",
    "executor-model",
    "executor-effort",
    "artifact-root",
  ],
  requiredResultFields: [
    "passed",
    "cost",
    "consultations",
    "taskId",
    "requests",
  ],
  resultPrefix: "BENCH_RESULT=",
};
