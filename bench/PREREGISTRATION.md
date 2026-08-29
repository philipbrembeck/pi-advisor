# pi-advisor benchmark preregistration

This file is part of the benchmark input. A section must be committed before the
run it governs; editing it after that run voids the run rather than changing the
interpretation.

## §1 — Band classification (committed before Stage 1 screening)

**Commitment:** 2026-08-29, before any screening invocation.

- Screening seeds are exactly `11` and `23`.
- Evaluation seeds are exactly `101`, `113`, `127`, `139`, and `151`.
  Screening and evaluation seed sets are disjoint; a screening result is never
  reused as an evaluation baseline.
- A ReactBench task passes only when its behavioral verifier passes **and** the
  submission introduces no new graded React Doctor finding. This is the
  ReactBench criterion, not an absolute ReactBench score reported by this
  project.
- With the two screening seeds, `E fails` means Executor-alone fails both seeds;
  `F passes` means frontier-alone passes at least one seed. Classification is:
  - `E passes` (at least one pass) → `trivial`;
  - `E fails ∧ F passes` → `candidate-uplift`;
  - `F fails` (and therefore no candidate-uplift condition) → `out-of-reach`.
- A task that meets both `E passes` and `F passes` is `trivial`, because the
  Executor already solved it. A task that ties at the boundary is retained as
  `candidate-uplift` only when it satisfies the explicit `E fails ∧ F passes`
  proxy above; the proxy is not claimed to be true E+A band membership.
- Candidate-band prevalence is `candidate-uplift tasks / all screened tasks`.
  It is reported as **candidate-band prevalence**, never as true uplift-band
  prevalence. True band membership is established only by Stage 2 E+A runs.
- The candidate-uplift corpus is retained in full. The trivial stratum is drawn
  with the seeded sampler from all trivial tasks, with at least three tasks;
  there is no hand-picking after outcomes are visible.

## §2 — Value decision (committed before the first Stage 2 evaluation run)

**Commitment:** 2026-08-29, before any evaluation invocation.

- For each task and arm, five evaluation seeds are reduced to one task outcome
  by majority vote: at least three passing seeds means the task passes. Best-of,
  worst-of, and per-seed hypothesis tests are not allowed.
- Q2 is reported as task-level paired discordance between `E` and `E+A`:
  `b = E fails ∧ E+A passes` and `c = E passes ∧ E+A fails`. McNemar's exact
  two-sided test is run on `(b, c)` after seed aggregation. Per-seed counts are
  descriptive only.
- Q3's primary result is the candidate-band-prevalence-reweighted
  `(USD-per-task, pass-rate)` point. The flow is **not worth it** when any of
  these holds:
  1. a null/oracle control invalidates the run;
  2. required provider usage or pricing is unavailable, so actual spend cannot
     be stated; or
  3. reweighted E+A costs at least frontier-alone, or its pass rate is below
     `0.90 ×` frontier-alone's pass rate.

  The `0.90` value is the pre-registered minimum fraction of frontier quality;
  “materially cheaper” is fixed as strictly lower cost, not selected after
  seeing the points. A candidate band with zero tasks is a valid `NO HEADROOM`
  result and receives no post-hoc corpus expansion.
- The diagnostic uplift-stratum plot is not the headline. Trivial and
  out-of-reach prevalence contributes to the reweighted result; out-of-reach
  pass rate is zero and its screening-measured cost is retained. The trivial
  stratum supplies E and E+A pass/cost behavior where no help was selected.
- The break-even consultation count is computed from the observed per-task
  Executor, Advisor, and frontier costs at the pinned gate settings. An
  unavailable or zero Advisor unit cost is reported as `unavailable` rather
  than imputed.
- The report may state direction and dominance verdicts only. It must not state
  an effect size, a ReactBench score, or precision finer than this small corpus
  supports. Differences within one item are reported as ties.

## Fixed pins

- Executor: `openai-codex/gpt-5.6-luna` @ `max`.
- Tier 2 cheap Advisor: `openai-codex/gpt-5.6-luna` @ `medium`.
- Tier 2 shipped Advisor: `openai-codex/gpt-5.6-sol` @ `medium`.
- Tier 3 frontier: `openai-codex/gpt-5.6-sol` @ `max`.
- Optional Tier 3 frontier-secondary: `openai-codex/gpt-5.6-sol` @ `medium`.
- Judge: `openai-codex/gpt-5.6-sol` @ `medium`.
- ReactBench commit: `11ff042e60ec83a613053fbd721a54ed4dbfdf6f`.
