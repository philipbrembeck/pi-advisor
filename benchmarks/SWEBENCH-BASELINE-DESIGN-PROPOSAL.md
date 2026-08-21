# SWE-bench Hard Baseline Design Proposal

**Status:** proposal only — no candidate retrieval, manifest freeze, preflight, or model inference has occurred.

## Decision boundary

The unpersisted 20-task expansion is cancelled. No Sol, Luna, Advisor, or Scout execution will use that selection. A new suite must be reviewed before inference.

## Selection protocol v1

1. **Freeze the rule first.** Record this protocol, dataset identity, repository support matrix, complexity formula, tie-breaker, and target counts before inspecting any model result.
2. **Build the candidate pool.** Retrieve the pinned `princeton-nlp/SWE-bench_Lite` test split and persist every row meeting only predeclared task-intrinsic eligibility checks:
   - complete instance ID, repository, base commit, problem statement, test patch, solution patch, FAIL_TO_PASS, and PASS_TO_PASS fields;
   - at least one FAIL_TO_PASS and one PASS_TO_PASS definition;
   - a production-file change in the canonical solution patch;
   - repository in the predeclared adapter support matrix: Django, Matplotlib, scikit-learn, Sphinx, or SymPy;
   - no intrinsically external-service test marker in canonical test paths (`postgresql`, `mysql`, `oracle`, `mongodb`, `selenium`, or `live_server`).
   The pool is persisted with its dataset-row hash. No runtime result or prior Sol/Luna/Advisor result is used.
3. **Compute intrinsic complexity.** For each candidate, calculate and persist:
   - production files changed;
   - production added plus removed lines;
   - production hunk count;
   - FAIL_TO_PASS count;
   - PASS_TO_PASS count;
   - problem-statement character count;
   - multi-module indicator from production paths;
   - repository and task-category strata where derivable from metadata.
   The complexity score is the sum of within-repository percentile ranks for these fields, with production-file count, production-line count, and multi-module status weighted 2×. This is a selection heuristic, not a model-performance estimate.
4. **Apply the frozen rule.** Select exactly four candidates from each of five repositories (20 total), using a deterministic greedy round-robin over repositories. In each repository select the highest-scoring unused candidate, then the highest unused candidate on each of the three coverage dimensions: production-file count, FAIL_TO_PASS count, and problem-statement length. Ties are resolved by ascending SHA-256 of `protocol-version || instance-id`. Require at least two selected multi-module tasks and at least eight selected tasks with either two or more production files or 20 or more production changed lines; otherwise stop and revise the protocol before retrieval of model results.
5. **Freeze order and identity.** Sort the selected tasks by SHA-256 of `protocol-version || instance-id`, persist the ordered IDs, complete canonical task definitions, all intrinsic metrics, candidate-pool hash, dataset snapshot, selection rule version, and exclusions. Hash the canonical manifest with SHA-256.

This intentionally favors a harder and broader metadata distribution than the five-task Django control while retaining repository diversity. It never uses historical model outcomes or expected Advisor suitability.

## Required review artifacts before inference

- candidate pool JSON plus SHA-256;
- frozen 20-task manifest plus SHA-256;
- selection provenance, including the exact dataset snapshot, eligibility predicate, complexity formula, tie-breaker, selected IDs, and excluded IDs/reasons;
- preflight report and runtime-equivalence report after the manifest is frozen;
- only after review approval: one immutable randomized 40-entry Sol/Luna schedule and experiment provenance.

A selected task that fails preflight is not replaced. The run stops and requires an explicitly reviewed new manifest version.

**Next action:** review this protocol. Do not run inference until the candidate pool and final manifest have been separately frozen and approved.
