# pi-advisor benchmark

`bench/` is a repository-only benchmark for the Executor/Advisor flow. It is
not included in the published npm package.

> [!CAUTION]
> This is a fully **vibe coded** benchmark harness. It is not a general-purpose benchmark framework and does not attempt to measure provider performance.
> Its sole purpose is to back the pi-advisor-flow with *somewhat* realistic numbers and to check whether they change significantly during release cycles or with new experimental features.

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
2. A clean ReactBench checkout at the configured commit (the wrapper fetches
   the pinned public checkout into a temporary cache when no path is set).
3. The local Pi installation's `openai-codex` OAuth session in
   `~/.pi/agent/auth.json` (override with `BENCH_PI_ADVISOR_AUTH_FILE`).
4. `BENCH_LIVE=1` and non-zero pinned catalog pricing.

The Harbor adapter uses the already-authenticated Pi/Codex subscription. It
starts a trial-local host broker that refreshes OAuth through Pi's Codex
credential, keeps the real token outside Harbor, and exposes only a
per-trial, budget-checked endpoint to the task container. No `BENCH_API_KEY`,
`OPENAI_API_KEY`, or `BENCH_BASE_URL` is needed for Tier 3.

Before running Harbor, verify that the Docker CLI exposes all three commands
used by its local backend:

```bash
docker info
docker compose version
docker buildx version
```

A standalone `docker-compose` executable is not enough; Harbor invokes the
Compose and Buildx CLI plugins as `docker compose` and `docker buildx`.

The zero-configuration command uses the pinned checkout, adapter, extension,
Pi version, and auth file defaults:

```bash
BENCH_LIVE=1 bun run bench:screen
```

Use these optional overrides only when needed:

```bash
export BENCH_REACTBENCH_ROOT=/path/to/reactbench/tasks
export BENCH_PI_ADVISOR_AUTH_FILE="$HOME/.pi/agent/auth.json"
export BENCH_PI_ADVISOR_ADAPTER="$PWD/bench/harbor/run-trial"
BENCH_LIVE=1 bun run bench:screen --config /tmp/pi-advisor-benchmark.json
```

The adapter receives one isolated trial at a time with the task path, seed,
arm, pinned model/effort values, and artifact directory. It must load the
pinned `pi-advisor` extension, refuse plain Pi, and print both records:

```text
BENCH_ADVISOR_ATTESTATION={"adapter":"pi-advisor-harbor","extension":"pi-advisor-flow","extensionVersion":"0.5.0","loaded":true,"mode":"advisor","advisorCalls":1,"shutdown":true}
BENCH_RESULT={"passed":true,"cost":0.12,"consultations":1,"taskId":"...","requests":[...]}
```

The `E+A` result must attest exactly one Advisor consultation. The `E`, `F`,
and optional `F′` results must attest the extension in executor mode and zero
Advisor consultations. The checked-in `bench/harbor/run-trial` executable starts Harbor with the
ReactBench checkout's pinned `uv.lock`, mounts only the extension/source and
recorder needed by the agent, forwards the seed/model/effort/pricing request,
gives the normal Pi client a remaining-USD lease enforced by the host-side
Codex broker before provider requests, and archives the Harbor result plus Pi
trajectory. It refuses to overwrite an existing trial
directory. The wrapper allowlists the provider and standard Pi installation
hosts. Set `BENCH_HARBOR_ALLOW_HOSTS` to a comma-separated list for any
additional installation host. It rejects missing trajectory, grader, request, usage, attestation, or
clean-shutdown artifacts, wrong model/effort pins, extra Advisor calls, and
zero E+A consultations. A credentialed smoke trial is still required before
screening; no model-quality or economic result is claimed before that gate.
The request/attestation files are runtime instrumentation written inside the
agent container, not cryptographic proof against a malicious agent: the
wrapper detects missing and inconsistent artifacts, but a hostile process with
shell access could forge them. The host broker is a conservative process-level
OAuth and budget boundary, not cryptographic isolation against a hostile
same-container agent. Harbor's verifier reward remains the independent grading
artifact.

Run Stage 2 only after Stage 1 has produced a screening report and the
corresponding preregistration section was committed. If `BENCH_SCREEN_REPORT`
is omitted, the newest `*-screen.json` report under `bench/reports/` is used.
The same host-side Pi/Codex OAuth broker is used for every fresh evaluation
trial.

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
If out-of-reach tasks have nonzero prevalence, E+A is not run there, so its
Advisor-inclusive reweighted cost is marked unavailable rather than equated
with Executor cost; the Q3 verdict fails closed.

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

The Gate A canary passed: Harbor ran the `hello-react` oracle task with one
trial, no exception, and reward/tests/React Doctor metrics all equal to `1.0`.
The host-side OAuth broker and pinned native Codex transport are covered by
offline proxy tests. On 2026-09-01, bounded authenticated smoke trials also
passed the artifact boundary: one `E` `fix-react` trial (seed `101`, normalized
cost `$0.0392`) and one `E+A` `write-react` trial (seed `103`, normalized cost
`$0.0658`). They resolved Executor `luna@max`, and the E+A trial resolved
Advisor `sol@medium` with exactly one consultation. Both task rewards were
`0`, so these are transport/integration evidence only, not model-quality or
economic results. See `bench/STATUS.md` for phase state.

## Provenance and licensing

The pinned ReactBench checkout has no `LICENSE` file or license section. This
repository does not vendor ReactBench task content. Checked-in decision
fixtures are original derived/control artifacts; any future ReactBench-derived
item must record its immutable source SHA and licensing decision in its
`item.toml`. The ReactBench canary is preserved in `fixtures/CANARY`.

## Safety rules

- Live commands refuse to run without `BENCH_LIVE=1`.
- Every live command prints an estimate and enforces the configured normalized
  USD-equivalent cap; the ChatGPT subscription is not an API invoice.
- Missing provider usage is reported as `unavailable`, never as zero.
- Tier 1 fails closed on privacy leaks, malformed fixtures, budget overruns,
  and nondeterminism.
- Reports are descriptive unless the preregistration section governing the run
  existed before that run.
