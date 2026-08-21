# pi-advisor-flow benchmark harness

This directory is a repository-only benchmark framework.

> [!CAUTION]
> This is a fully **vibe coded** benchmark harness. It is not a general-purpose benchmark framework and does not attempt to measure provider performance.
> It's sole purpose is to back the pi-advisor-flow with *somewhat* realistic numbers and to check if they change signifciantly during release cycles or with new experimental features.

## Suites

`benchmarks/tasks/` is the preserved v1 **micro** suite: 20 small tasks and archived results. Do not edit those fixtures when calibrating the harder suite.

`benchmarks/trajectory/` is the initial **trajectory** pilot: exactly three realistic repositories covering multi-file debugging, recovery/state lifecycle, and cross-module architectural constraints. It is intentionally a calibration slice, not a statistically broad result.

Run the trajectory pilot with the same production Advisor flow:

```bash
bun benchmarks/src/cli.ts \\
  --config benchmarks/config/benchmark.local.json \\
  --tasks benchmarks/trajectory \\
  --runs 1 \\
  --concurrency 2 \\
  --results benchmarks/results/trajectory-pilot.jsonl
```

Use `--concurrency N` for a bounded worker pool. Each attempt still gets its own child process, workspace, session, and Advisor configuration. The default is conservative (`1`); rate-limit/provider failures are recorded rather than silently retried. Re-running the same command resumes compatible completed `task × mode × repetition` records using the persisted configuration hash. Use a new results path after changing models, pricing, tasks, prompts, validators, or execution settings.

## Smoke run

The checked-in example uses placeholder model names. A local config is intentionally ignored. This checkout has a real local config using the configured Pi models (`openai-codex/gpt-5.6-luna` as small Executor and `openai-codex/gpt-5.6-sol` as frontier Advisor), their runtime pricing snapshot, and Pi's existing OAuth auth source:

```bash
bun benchmarks/src/cli.ts \
  --config benchmarks/config/benchmark.local.json \
  --task implementation-01,debugging-01,recovery-01 \
  --runs 1 \
  --seed 20260815 \
  --results benchmarks/results/real-smoke-12.jsonl
```

For another machine, copy the example, replace the model refs/prices, and use ambient Pi credentials. The worker reads the global auth/model files read-only; it keeps a fresh benchmark `PI_CODING_AGENT_DIR` for each attempt. A per-run capability token enables the optional benchmark telemetry bridge inside the child only; ordinary Pi sessions leave that bridge disabled, and telemetry never persists prompts, source contents, thinking, or raw provider errors.

The persisted calibration golden fixtures are checked with:

```bash
bun test ./benchmarks/test/golden-checks.ts
```

For deterministic pipeline tests without provider access (the full 20-task × 4-mode smoke produces 80 records):

```bash
bun benchmarks/src/cli.ts \
  --config benchmarks/config/benchmark.example.json \
  --runs 1 \
  --mock \
  --progress-interval 5 \
  --results /tmp/pi-benchmark.jsonl
bun benchmarks/src/cli.ts report --input /tmp/pi-benchmark.jsonl
```

Target a task, mode, or category with `--task implementation-01`, `--mode advisor`, and `--category debugging`. Use `--seed` to replay the seeded schedule. Long runs emit `[benchmark-progress]` heartbeats every 30 seconds by default; override with `--progress-interval 15`. When using Herdr, run the command in a separate no-focus pane so progress remains visible while the main session stays usable. Report generation reads existing JSONL only and never contacts a provider:

```bash
bun benchmarks/src/cli.ts report \
  --input benchmarks/results/real-smoke-12.jsonl \
  --markdown benchmarks/results/real-smoke-12.md \
  --json benchmarks/results/real-smoke-12.json
```

## Harness audit and experimental modes

Do not interpret trajectory results as model capability evidence until the audit report is reviewed. Generate a machine-readable audit from an existing JSONL run with:

```bash
bun benchmarks/src/audit.ts benchmarks/results/trajectory-3x3.jsonl /tmp/trajectory-audit.json /tmp/trajectory-audit.md
```

The default four modes remain unchanged. Diagnostic modes are selectable with `--mode` and are not silently substituted: `sol`, `luna`, `luna-advisor-optional`, `luna-advisor-mandatory`, `luna-advisor-scout`, and `advisor-guidance`. Each non-mock result now records effective runtime configuration, sanitized executor provider request options, and observable trajectory events; secrets and prompt-bearing provider fields are redacted from provider diagnostics. Validation retains parent-only invariant codes after a run. Pairing requires task, repetition, experiment, fixture, and task hashes; missing legacy fields remain unknown rather than equivalent. `luna-advisor-optional` has no benchmark-forced call, while `luna-advisor-mandatory` preserves the historical prompt treatment.

## Isolation and validation

Every non-mock attempt receives a fresh temporary workspace, agent directory, in-memory Pi session, and private Advisor configuration. The worker loads the real `extensions/index.ts` through the Pi SDK and waits for `agent_settled`. The parent runs the validator only after the worker exits. Validator programs and expected acceptance logic remain outside the fixture copied to the agent workspace. Provider caches, throttling, rate limits, and external service state are intentionally out of scope.

A worker or validator failure is retained as a failed raw record and classified separately as validation failure, agent timeout, validator timeout, provider failure, or infrastructure failure. There are no benchmark-level retries. Provider-reported usage is retained separately from configured pricing; missing nested-role usage remains unknown rather than being fabricated as zero. Reports show known-cost coverage and never treat missing usage as zero. Executor usage and Advisor tool-call identity come from SDK session events. Raw trajectory diagnostics also retain model-call, tool-call, file-read, edit, test-execution, changed-file, and diff metrics when available. Benchmark runs enable a scoped, ephemeral telemetry bridge at the Advisor/Scout boundaries, while ordinary extension sessions remain uninstrumented and unchanged. Large-context/provider runs can be slow or timeout; use a selected calibration subset first and retain those infrastructure outcomes instead of silently dropping them.

## Adding a task

Create `benchmarks/tasks/<stable-id>/task.json` and a `fixture/` directory for micro tasks, or `benchmarks/trajectory/<stable-id>/task.json` for trajectory tasks. The manifest declares one of `implementation`, `debugging`, `reasoning`, or `recovery`, a bounded prompt, and a validator path. Put deterministic validators in `benchmarks/validators/`, not in the fixture. Validators receive the temporary workspace as their current directory and must exit 0 only when the task is correct.

The suite contains five multi-case tasks in each of implementation, debugging, reasoning, and recovery. Validators exercise edge cases, state transitions, recovery paths, and interacting constraints; the benchmark test suite rejects every untouched fixture and runs persisted golden solutions for all 20 tasks. The smoke workflow can select the original three representative tasks with `--task implementation-01,debugging-01,recovery-01`; sparse category selections are reported as unavailable rather than padded with invented results. `reasoning-05` is deliberately large-context: 26 source files, including 20 distractors, with a cross-file idempotent queue bug for Scout calibration.

## SWE-bench control adapter

The pinned five-task control lives under `benchmarks/swebench/`. It checks out each exact base commit, applies and commits the canonical test patch before inference, captures the prepared-to-post-model patch, and validates production-only changes in a separate canonical worktree. Test-patch files are recorded and protected from changing the grader. Setup and runtime-configuration failures are unscorable and are never converted into model failures.

Run the gates in order, then the exact five-task control:

```bash
bun benchmarks/swebench/cli.ts preflight
bun benchmarks/swebench/cli.ts probe --config benchmarks/config/benchmark.local.json
bun benchmarks/swebench/cli.ts run --config benchmarks/config/benchmark.local.json --concurrency 4
bun benchmarks/swebench/cli.ts report --input benchmarks/swebench/results/exp-20260818-swebench-control-v2.jsonl
```

The control manifest is immutable for this experiment. Do not use this adapter to expand the task set or run Advisor modes without a new predeclared experiment identity.
