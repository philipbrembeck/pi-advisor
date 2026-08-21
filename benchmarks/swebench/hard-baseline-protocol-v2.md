# SWE-bench Hard Baseline Selection Protocol v2

Status: **frozen protocol correction; no inference performed**

## v1 feasibility failure

Protocol v1 was applied to the pinned SWE-bench_Lite test split after its
clarification and module mapping had been frozen. The eligible pool contained
243 candidates:

```text
Django          110
Matplotlib       19
scikit-learn    23
Sphinx           15
SymPy            76
-----------------
Total           243
```

All `243/243` canonical solution patches modified exactly one production file.
Consequently every candidate had `multiModule = false`, and the v1 requirement
`selected multi-module tasks >= 2` was mathematically impossible. The
four-per-repository v1 selection was deterministic but was not frozen as a
manifest. This is a **protocol feasibility failure**, not an adapter preflight
failure. No model inference, Sol/Luna run, Advisor/Scout benchmark invocation,
leaderboard result, or generated model patch was used.

The v1 provenance is immutable:

- Original protocol SHA-256:
  `713969971fc2588ebf9ee300d66de9ce906dd6b4f5264e72017597912f4e33d1`
- v1 clarification SHA-256:
  `8c055469c1f505e7faa81f12dbedbf0e2a95e0eaebe1a18e527ee766ff1c2878`
- v1 module mapping SHA-256:
  `e59d066c06ea521fbf66f70ee20092b423b2c180c4070c8b590d0e6912e8e0d2`
- v1 effective protocol identity:
  `aaf2d5e678aac2ec121c42ed0d1f72b024194bc2fe825748cf1baa1865187443`
- v1 candidate-pool SHA-256:
  `6282101e12dd1d79667de8f04e45554971d329c9be058b864186fb7394eb9dbb`

## Minimal v2 changes

Everything else remains as frozen by v1, including dataset revision,
supported repositories, eligibility and external-service exclusions, percentile
ranking and average-rank ties, raw metrics, repository quota, selection order,
coverage selectors, tie hash, manifest ordering, leakage rules, and adapter
preflight rules.

### Effective v2 complexity

`productionFilesChanged` and `multiModule` remain persisted v1 raw metrics for
provenance. `productionFilesChanged` remains the second selector exactly as in
v1. Neither constant field contributes to the v2 effective complexity score.
The v2 score is:

```text
complexity_v2 =
    2 * pct(productionLinesChanged)
  + 1 * pct(productionHunkCount)
  + 1 * pct(failToPassCount)
  + 1 * pct(passToPassCount)
  + 1 * pct(problemStatementLength)
```

The same within-repository percentile procedure is used: ascending average
ranks for ties, `(average_rank - 1) / (n - 1)` for `n > 1`, and `0.5` for
`n == 1`. The score is not normalized again. It remains the **intrinsic
complexity heuristic**, never a difficulty score. Its theoretical range is
approximately `0..6`.

The production-file count remains in the persisted raw metrics and is retained
as the raw target of the production-file coverage selector. It is not replaced
with another selector merely because it is constant.

### Selection and tie rules

For each repository, sequentially select four unique unused candidates using:

1. highest `complexity_v2` (tie hash ascending);
2. highest `productionFilesChanged`, then `complexity_v2` descending, then tie
   hash ascending;
3. highest `failToPassCount`, then `complexity_v2` descending, then tie hash
   ascending;
4. highest `problemStatementLength`, then `complexity_v2` descending, then tie
   hash ascending.

The tie hash remains the lowercase SHA-256 digest of UTF-8 bytes of:

```text
v1||instance-id
```

The final manifest order is the selected sequence sorted by tie hash ascending.

### v2 coverage constraints

The feasible v1 structural expression is preserved exactly:

```text
selected tasks satisfying
productionFilesChanged >= 2 OR productionLinesChanged >= 20
>= 8
```

Given the observed pool distribution, this is reported as equivalent to
selected tasks with `productionLinesChanged >= 20`, but the historical
expression is not rewritten in provenance.

The replacement v2 constraint is:

```text
selected tasks with failToPassCount >= 2 >= 4
```

If either constraint fails, stop with `PROTOCOL V2 COVERAGE FAILED`; do not
substitute tasks and do not freeze a manifest.

## Candidate-pool reuse

The existing candidate pool may be reused only after verifying all of:

- dataset name/config/split and revision are unchanged;
- eligibility and external-service rules are unchanged;
- the candidate-pool file hashes to the recorded v1 candidate-pool SHA.

No dataset retrieval or candidate-pool rebuild is part of v2 construction.

## Effective v2 identity

The v2 protocol hash is the SHA-256 of this file's exact UTF-8 bytes. The
selection-effective identity is the SHA-256 of the UTF-8 bytes of this
newline-delimited canonical input:

```text
protocol-v2-sha256
v1-effective-protocol-identity
candidate-pool-sha256
module-mapping-sha256
selector-algorithm-v2
```

`selector-algorithm-v2` is the literal string `four-per-repository-v2-score-and-frozen-coverage-selectors`.
This records every selection-affecting artifact without overwriting the v1
identity.

## Leakage and preflight

Selection provenance must record that no Sol, Luna, Advisor, Scout,
leaderboard/model-performance result, historical generated patch, or prior
outcome was consulted. After v2 membership is frozen, run the canonical
inference-free adapter preflight against exactly that manifest. A failed task
is not replaced; the result is `MANIFEST PREFLIGHT FAILED` and requires
protocol v3 review.
