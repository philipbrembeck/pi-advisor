# pi-advisor benchmark

This directory contains the repository-only benchmark for the Executor/Advisor flow. It is deliberately excluded from the published npm package.

> [!CAUTION]
> This is a fully **vibe coded** benchmark harness. It is not a general-purpose benchmark framework and does not attempt to measure provider performance.
> Its sole purpose is to back the pi-advisor-flow with *somewhat* realistic numbers and to check whether they change significantly during release cycles or with new experimental features.

## Tiers

- `bun run bench:replay` — hermetic Tier 1 conformance. It uses checked-in fixtures, no provider, no API key, and no network.
- `bun run bench:decisions` — Tier 2 decision-point scoring. Without `BENCH_LIVE=1` it validates the 24-item corpus and deterministic controls; live model calls require an explicit endpoint, credential, non-zero pricing, and budget.
- `bun run bench:screen` — Tier 3 Stage 1 screening. It requires `BENCH_LIVE=1`, the Harbor feasibility gate, a ReactBench checkout, and `BENCH_PI_ADAPTER` (or the compatibility alias `BENCH_REACTBENCH_RUNNER`).
- `bun run bench:evaluate` — Tier 3 Stage 2 uplift/dominance evaluation. It requires `BENCH_LIVE=1`, a completed screening report, the same Pi adapter, and preregistration.

Use `--help` on each command for options. Generated reports are written below `bench/reports/` and are not committed unless a result is intentionally archived.

Live Tier 2 example (the endpoint must be OpenAI-compatible and the provider must
resolve the pinned model ids):

```bash
BENCH_LIVE=1 \
BENCH_BASE_URL=https://provider.example/v1 \
BENCH_API_KEY=... \
bun run bench:decisions
```

Set `BENCH_SCOUT=1` to run the Scout on/off sub-experiment. `BENCH_PROVIDER` and
`BENCH_API` select the provider serialization; defaults are `openai-codex` and
`openai-completions`. The live runner records and asserts model and effort on
every serialized request. It refuses missing pricing or credentials and writes
`UNAVAILABLE` rather than inventing a cost. The Pi adapter command receives
`--task`, `--seed`, `--arm`, the pinned model/effort flags, and `--artifact-root`,
and must emit one `BENCH_RESULT=<json>` record with `passed`, `cost`,
`consultations`, and `taskId`.

## Reading reports

Each run writes versioned JSON and a Markdown summary containing the pi-advisor
and Pi versions, model ids and effort levels, ReactBench/React Doctor pins,
fixture hashes, gate settings, controls, budget, and warnings. Tier 2 reports
keep the mechanical positive-item score separate from the judge score and retain
per-item judge justifications. A live run is `INVALID` when the null/oracle
controls fail; `UNAVAILABLE` means no quality number was defensibly measured.
Tier 3 reports use task-level majority outcomes for Q2 and show both the
uplift-stratum diagnostic and candidate-prevalence-reweighted Q3 point. Never
interpret either tier as an absolute ReactBench score.

## Re-seeding Tier 2

`bench/src/harvest.ts` converts archived candidate-uplift failures into positive
items and trivial-band passes into negative controls. It records the source run,
task, seed, and ReactBench SHA while keeping the repository and scorer keys out
of Advisor context. Keep authored and harvested corpora side by side until the
harvested set has at least the same null/frontier/oracle discrimination, then
schedule a fresh harvest before public answer keys contaminate the models.

## Harbor provider access

Spike recorded 2026-08-29 from the pi-advisor checkout:

- ReactBench was fetched successfully at commit `11ff042e60ec83a613053fbd721a54ed4dbfdf6f`.
- `uvx --from harbor harbor --help` installed Harbor `>=0.18` and exposed the task runner and shipped adapters.
- Docker is installed, but its configured Colima daemon was stopped. `docker info` failed because `/Users/philipbrembeck/.colima/default/docker.sock` did not exist; starting the existing Colima instance also failed while downloading its VM image (`clonefile failed: no such file or directory`). The direct canary attempt, `uvx --from harbor harbor run -p /private/tmp/reactbench/tasks/hello-react -a oracle`, failed with `Docker daemon is not running`.
- Consequently, a ReactBench container could not be started in this environment and provider egress from an agent container could not be tested. ReactBench documents that agent containers have no internet and that model access must be provided by the adapter/runtime path.

**Gate A outcome:** Harbor/container provider feasibility is unresolved here, not silently assumed. An outside-Harbor Pi adapter is recorded only as a **provisional fallback proposal** for this checkout; it has not been selected as the authoritative harness. No corpus is claimed to be screened until a live run records the container/runtime path and provider reachability. A future operator with a working Docker daemon must rerun the spike before publishing Tier 3 results.

## Provenance and licensing

The upstream ReactBench README at the pinned commit has no `LICENSE` file or license section. This repository therefore does not vendor ReactBench task content. Checked-in decision fixtures are original derived/control artifacts; any future ReactBench-derived item must record its immutable source SHA and licensing decision in its `item.toml`. The ReactBench canary is preserved in `fixtures/CANARY` as requested by upstream.

## Safety rules

- Live commands refuse to run without `BENCH_LIVE=1`.
- Every live command prints a cost estimate and enforces the configured USD cap before a provider request.
- Missing provider usage is reported as `unavailable`, never as zero.
- Tier 1 controls fail closed on privacy leaks, malformed fixtures, budget overrun, and nondeterminism.
- Reports are descriptive unless their preregistration section exists before the run.
