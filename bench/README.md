# pi-advisor benchmark

`bench/` is a repository-only benchmark for the Executor/Advisor flow. It is
not included in the published npm package.

> [!CAUTION]
> This is a fully **vibe coded** benchmark harness. It is not a general-purpose benchmark framework and does not attempt to measure provider performance.
> It's sole purpose is to back the pi-advisor-flow with *somewhat* realistic numbers and to check if they change signifciantly during release cycles or with new experimental features.

The benchmark has three isolated tiers:

| Tier | Command | What it can establish |
| --- | --- | --- |
| 1 — replay | `bun run bench:replay` | Hermetic regression and privacy checks |
| 2 — decisions | `bun run bench:decisions` | Advisor decision-point scoring |
| 3 — ReactBench | `bun run bench:screen` / `bun run bench:evaluate` | End-to-end uplift and cost/value evidence |

Tier 3 is the only tier that can support a product value claim. The other tiers
are regression signals and must not be presented as absolute ReactBench scores.

## Quick start

Run these commands from the repository root:

```bash
# No network, credentials, or external checkout required.
bun run bench:replay

# Validates the 24 checked-in fixtures and deterministic controls.
bun run bench:decisions --no-report
```

The checked-in decision corpus contains 12 positive items and 12 negative
controls. Each item is under `bench/tasks/<item-id>/`; its `repo/` directory is
an intentionally empty placeholder. Offline commands do not read a local
project checkout or any path outside this repository.

## Live Tier 2

Live work is opt-in. It requires an OpenAI-compatible endpoint, credentials,
non-zero pricing for every live model pin, and a budget that covers the printed
estimate. Copy the example configuration and replace its zero pricing values;
do not commit credentials or private endpoints.

```bash
cp bench/benchmark.example.json /tmp/pi-advisor-benchmark.json
# Edit /tmp/pi-advisor-benchmark.json and set real per-token pricing.

export BENCH_BASE_URL=https://provider.example/v1
export BENCH_API_KEY=replace-with-a-secret
BENCH_LIVE=1 bun run bench:decisions \
  --config /tmp/pi-advisor-benchmark.json
```

Set `BENCH_SCOUT=1` to run the Scout on/off experiment. `BENCH_PROVIDER` and
`BENCH_API` control provider serialization; defaults are `openai-codex` and
`openai-completions`. Every live request records and verifies its pinned model
and effort. Missing usage is reported as unavailable, never as zero.

## Live Tier 3

Tier 3 requires all of the following:

1. A successful Harbor/ReactBench feasibility spike.
2. A ReactBench checkout at the configured commit.
3. An executable Pi adapter command.
4. A live provider endpoint and non-zero pricing.

Before running Harbor, verify that the Docker CLI exposes all three commands
used by its local backend:

```bash
docker info
docker compose version
docker buildx version
```

A standalone `docker-compose` executable is not enough; Harbor invokes the
Compose and Buildx CLI plugins as `docker compose` and `docker buildx`.

Set paths for the current checkout; these are operator-supplied and are not
part of the repository:

```bash
export BENCH_REACTBENCH_ROOT=/path/to/reactbench
export BENCH_PI_ADAPTER=/path/to/pi-reactbench-adapter

BENCH_LIVE=1 bun run bench:screen \
  --config /tmp/pi-advisor-benchmark.json
```

The adapter receives one isolated trial at a time with the task path, seed,
arm, pinned model/effort values, and artifact directory. It must print one
structured result line:

```text
BENCH_RESULT={"passed":true,"cost":0.12,"consultations":1,"taskId":"...","requests":[...]}
```

Run Stage 2 only after Stage 1 has produced a screening report and the
corresponding preregistration section was committed. If `BENCH_SCREEN_REPORT`
is omitted, the newest `*-screen.json` report under `bench/reports/` is used.

```bash
export BENCH_SCREEN_REPORT=/path/to/screen-report.json
BENCH_LIVE=1 bun run bench:evaluate \
  --config /tmp/pi-advisor-benchmark.json
```

Generated reports are written to `bench/reports/`. They are ignored by Git
except for the directory placeholder.

## Reading reports

Check the report status before reading metrics:

- `PASS` — the requested run completed and its controls passed.
- `INVALID` — null/oracle controls failed; quality metrics are void.
- `UNAVAILABLE` — the tier could not make its claim; no value was imputed.

Reports include versioned pins, model ids and effort levels per arm, gate
settings, fixture hashes, budget accounting, controls, and warnings. Tier 2
keeps the positive mechanical score separate from the LLM judge and retains
judge justifications. Tier 3 aggregates five seeds to task-level outcomes for
Q2 and reports the candidate-band-reweighted cost/pass-rate comparison for Q3.

The benchmark never reports an absolute ReactBench score. Its results are
paired comparisons between fixed arms on the same tasks and seeds.

## Re-seeding Tier 2

`bench/src/harvest.ts` converts archived Tier 3 trajectories into positive and
negative decision items while keeping scorer keys out of Advisor context. Keep
hand-authored and harvested corpora side by side until the harvested set is at
least as discriminating, then schedule a fresh harvest before public answer
keys contaminate the models.

## Harbor provider access

ReactBench is pinned to commit
`11ff042e60ec83a613053fbd721a54ed4dbfdf6f`, and Harbor exposes the task runner
and shipped adapters. The default Colima profile was rebuilt after its cached
VM image and disk link were missing.

The Gate A canary then passed: Harbor ran the `hello-react` oracle task with
one trial, no exception, and reward/tests/React Doctor metrics all equal to
`1.0`. A separate allowlisted probe also ran Harbor's Pi agent inside a task
container. Pi reached `https://api.openai.com/v1/models` and received the
expected `401` response for a deliberately invalid probe key. That verifies the
container-to-provider network path without making a paid model request.

**Gate A status:** container startup, ReactBench grading, and allowlisted
provider transport are validated. A real authenticated provider run is still
required before screening; no model-quality or economic result is claimed.
The benchmark's Pi/ReactBench adapter is still required to make the pinned
Executor/Advisor flow reproducible. See `bench/STATUS.md` for phase state.

## Provenance and licensing

The pinned ReactBench checkout has no `LICENSE` file or license section. This
repository does not vendor ReactBench task content. Checked-in decision
fixtures are original derived/control artifacts; any future ReactBench-derived
item must record its immutable source SHA and licensing decision in its
`item.toml`. The ReactBench canary is preserved in `fixtures/CANARY`.

## Safety rules

- Live commands refuse to run without `BENCH_LIVE=1`.
- Every live command prints an estimate and enforces the configured USD cap.
- Missing provider usage is reported as `unavailable`, never as zero.
- Tier 1 fails closed on privacy leaks, malformed fixtures, budget overruns,
  and nondeterminism.
- Reports are descriptive unless the preregistration section governing the run
  existed before that run.
