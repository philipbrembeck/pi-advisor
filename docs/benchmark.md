# Benchmarking pi-advisor

The repository-only benchmark lives in [`../bench/`](../bench/). It is not part
of the npm package.

## Tiers

- **Tier 1 replay:** `bun run bench:replay`. This is hermetic, deterministic,
  uses a local OpenAI-compatible mock, requires no API key or network, and runs
  in pull-request CI. A non-zero result is a regression in the shipped gate,
  disclosure, context, budget, or pin seams.
- **Tier 2 decisions:** `bun run bench:decisions`. Without `BENCH_LIVE=1` it
  validates the 24 decision fixtures and null/oracle controls. A live run needs
  `BENCH_BASE_URL`, `BENCH_API_KEY` (or `OPENAI_API_KEY`), non-zero pricing in a
  config file, and `BENCH_LIVE=1`; it is scheduled rather than run on PRs.
  `BENCH_SCOUT=1` enables the Scout on/off experiment.
- **Tier 3 screening:** `BENCH_LIVE=1 bun run bench:screen`. It requires a
  successful Harbor/provider feasibility spike, `BENCH_REACTBENCH_ROOT`, and a
  Pi/ReactBench adapter command. It classifies tasks using the committed §1
  preregistration and reports candidate-band prevalence as a proxy.
- **Tier 3 evaluation:** `BENCH_LIVE=1 bun run bench:evaluate`. It consumes a
  screening report and fresh, disjoint seeds. The committed §2 preregistration
  governs task-level majority aggregation, McNemar's exact test, and Q3's
  dominance threshold.

Live tiers are quality signals. They run only from `workflow_dispatch` or a
schedule and do not block releases. Missing providers, budgets, or usage yield
`UNAVAILABLE`, not a fabricated zero or a successful value claim.

## Reading a report

Reports are versioned JSON plus a Markdown summary under `bench/reports/`.
Always check the pins first: pi-advisor and Pi versions, model ids **and effort
levels**, ReactBench SHA, React Doctor version, gate settings, and fixture
hashes. `INVALID` means null/oracle controls failed and the quality number must
be voided. `UNAVAILABLE` means the tier could not make its claim.

Tier 2 reports separate the positive mechanical location lower bound from the
LLM judge, retain judge justifications, and report catch rate, false-alarm rate,
`J`, cost per catch, and p50/p95 latency. With 24 items, differences within one
item are ties; the tier does not support finer precision.

Tier 3 Q2 counts `E fails ∧ E+A passes` and `E passes ∧ E+A fails` after five
seeds are reduced to one outcome per task. Per-seed counts are descriptive only.
Q3's headline is the candidate-prevalence-reweighted USD/pass-rate point; the
uplift-only plot is diagnostic. The report also gives the break-even number of
Advisor consultations at the pinned settings.

The benchmark never reports an absolute ReactBench score. Its claims are paired
comparisons between the fixed arms on the same tasks and seeds.
