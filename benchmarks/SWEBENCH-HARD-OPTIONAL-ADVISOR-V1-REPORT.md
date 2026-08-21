# SWE-bench Hard Optional Advisor v1 Report

Results: `/Users/philipbrembeck/.pi/agent/extensions/pi-advisor/benchmarks/swebench/results/exp-20260820-swebench-hard-optional-advisor-v1.jsonl`
Experiment: `exp-20260820-swebench-hard-optional-advisor-v1`

## Runtime-equivalence proof

- Proof artifact: runtime-equivalence.json
- Unexpected runtime differences: []
- Allowed differences: ["activeTools adds ask_advisor","advisor assignment changes from null to Sol","advisorMaxCallsPerSession changes from 0 to 4","advisor policy changes from none to optional"]
- Frozen manifest: benchmarks/swebench/hard-baseline-v2-manifest.json
- Manifest canonical SHA: 44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193
- Manifest semantic SHA: f47a191590b8a39880a6770023035e812e8cae886b94a0f16e34e7c59dcbd588
- Candidate-pool SHA: 6282101e12dd1d79667de8f04e45554971d329c9be058b864186fb7394eb9dbb
- Frozen task order: sympy__sympy-16792, sphinx-doc__sphinx-8474, django__django-11019, sphinx-doc__sphinx-7686, scikit-learn__scikit-learn-15535, matplotlib__matplotlib-25442, sympy__sympy-20639, sympy__sympy-20049, sphinx-doc__sphinx-10451, scikit-learn__scikit-learn-25747, django__django-16820, sympy__sympy-21171, scikit-learn__scikit-learn-14092, matplotlib__matplotlib-23964, django__django-13265, matplotlib__matplotlib-18869, django__django-14997, matplotlib__matplotlib-22711, scikit-learn__scikit-learn-25638, sphinx-doc__sphinx-8713
- Plan SHA: f81e2b607c365562b7e53d3f4b6bb6794061cdd3dfe1d95cc78f5aa4fc2c59ce
- Schedule SHA: 11b816dbf4b99ca9d13d0d79661a6d78444325633247cefa4302927f64739883
- Schedule disclosure: the deterministic schedule ran the 20 Luna cells first and the 20 optional-Advisor cells second; this sequential block is a temporal/provider confound.
- Luna prompt: exact frozen task prompt.
- Optional prompt: exact frozen task prompt; no mandatory Advisor suffix.
- Mandatory Advisor: no.
- Scout: no.

## Paired 20-task matrix

| Task | Repository | Luna | Optional Advisor | Outcome | Advisor calls |
| --- | --- | --- | --- | --- | ---: |
| sympy__sympy-16792 | sympy/sympy | PASS | PASS | both-pass | 1 |
| sphinx-doc__sphinx-8474 | sphinx-doc/sphinx | PASS | PASS | both-pass | 1 |
| django__django-11019 | django/django | PASS | PASS | both-pass | 2 |
| sphinx-doc__sphinx-7686 | sphinx-doc/sphinx | PASS | FAIL | luna-only | 2 |
| scikit-learn__scikit-learn-15535 | scikit-learn/scikit-learn | PASS | PASS | both-pass | 0 |
| matplotlib__matplotlib-25442 | matplotlib/matplotlib | PASS | PASS | both-pass | 1 |
| sympy__sympy-20639 | sympy/sympy | PASS | FAIL | luna-only | 0 |
| sympy__sympy-20049 | sympy/sympy | PASS | PASS | both-pass | 1 |
| sphinx-doc__sphinx-10451 | sphinx-doc/sphinx | PASS | FAIL | luna-only | 2 |
| scikit-learn__scikit-learn-25747 | scikit-learn/scikit-learn | PASS | PASS | both-pass | 1 |
| django__django-16820 | django/django | PASS | PASS | both-pass | 0 |
| sympy__sympy-21171 | sympy/sympy | PASS | PASS | both-pass | 1 |
| scikit-learn__scikit-learn-14092 | scikit-learn/scikit-learn | PASS | PASS | both-pass | 2 |
| matplotlib__matplotlib-23964 | matplotlib/matplotlib | PASS | PASS | both-pass | 1 |
| django__django-13265 | django/django | PASS | PASS | both-pass | 2 |
| matplotlib__matplotlib-18869 | matplotlib/matplotlib | PASS | PASS | both-pass | 1 |
| django__django-14997 | django/django | PASS | FAIL | luna-only | 2 |
| matplotlib__matplotlib-22711 | matplotlib/matplotlib | FAIL | FAIL | both-fail | 2 |
| scikit-learn__scikit-learn-25638 | scikit-learn/scikit-learn | PASS | PASS | both-pass | 0 |
| sphinx-doc__sphinx-8713 | sphinx-doc/sphinx | PASS | PASS | both-pass | 0 |

## Rescue and regression

- Luna failures: 1
- Rescued failures (Luna FAIL → Optional PASS): 0
- Rescue rate: 0.0%
- Luna successes: 19
- Regressions (Luna PASS → Optional FAIL): 4
- Regression rate: 21.1%
- Net success gain: -20.0 pp
- both pass: 15
- Advisor-only pass: 0
- Luna-only pass: 4
- both fail: 1
- unscorable: 0
- exact two-sided paired p-value: 0.125000
- Interpretation: n=20 is a small paired calibration sample; no significance claim is made.

## Baseline discordant-task analysis

| Task | Baseline Sol | Baseline Luna | Fresh Luna | Optional result | Rescued? | Preserved Luna-only success? |
| --- | --- | --- | --- | --- | --- | --- |
| sympy__sympy-16792 | PASS | FAIL | PASS | PASS | no | n/a |
| sphinx-doc__sphinx-8474 | PASS | FAIL | PASS | PASS | no | n/a |
| matplotlib__matplotlib-22711 | PASS | FAIL | FAIL | FAIL | no | n/a |
| scikit-learn__scikit-learn-25747 | FAIL | PASS | PASS | PASS | n/a | yes |
| django__django-13265 | FAIL | PASS | PASS | PASS | n/a | yes |
| django__django-14997 | FAIL | PASS | PASS | FAIL | n/a | no |

## Advisor usage and selectivity

- tasks with zero Advisor calls: 5
- tasks with >=1 Advisor call: 15
- Advisor calls/task: 1.10
- Baseline Luna-pass denominator: 16; baseline Luna-fail denominator: 4.
- Calls/successful task is total Advisor calls divided by optional-mode tasks whose canonical validation passed.
- Advisor calls/successful task: 0.93

| Baseline category | Tasks | Advisor calls | Tasks with call | Mean calls/task |
| --- | ---: | ---: | ---: | ---: |
| both-pass | 13 | 13 | 9 | 1.00 |
| Sol-only | 3 | 4 | 3 | 1.33 |
| Luna-only | 3 | 5 | 3 | 1.67 |
| both-fail | 1 | 0 | 0 | 0.00 |

## Observable rescues

| Task | Advisor question | Advisor response summary | Subsequent executor action | Baseline Luna invariant | Optional invariant outcome |
| --- | --- | --- | --- | --- | --- |

## Observable regressions

| Task | Advisor calls | Question | Response summary | Earliest post-Advisor divergence | Optional failure taxonomy | Luna baseline evidence |
| --- | ---: | --- | --- | --- | --- | --- |
| sphinx-doc__sphinx-7686 | 2 | Review the intended minimal fix for this old Sphinx autosummary bug. In generate_autosummary_content, module template ns['members'] is always dir(obj), while functions/classes use imported_members filtering. What filtering semantics should ns['members'] use to exclude imported modules like `os` when false while retaining module metadata dunders? | Use an ownership-aware filter, not simply `getattr(value, '__module__', None) == obj.__name__`: modules such as `os` have no `__module__`, and that approach also drops constants and metadata.

When `imported_members` is false, `ns['members']` should:

- Always retain module metadata dunders.
- Retain ordinary values without an identifiable owner, such as constants.
- Retain functions/classes whose `__module__` equals the documented module.
- Exclude functions/classes owned by another module.
- S | edit | unknown | Luna baseline PASS |
| sympy__sympy-20639 | 0 | N/A | N/A | no Advisor call; failure is not attributable to Advisor | unknown | Luna baseline PASS |
| sphinx-doc__sphinx-10451 | 2 | Review the production fix approach for Sphinx autodoc_typehints duplicated *args/**kwargs. Is recording annotation keys with the syntactic * / ** prefixes and matching field names exactly sufficient, and what edge cases should be addressed? | Recording prefixed keys and exact matching is not sufficient and is demonstrably backward-incompatible: the three failing legacy tests show unstarred `:param args:` / `:param kwargs:` fields no longer receive their annotations.

Recommended approach:

- Keep annotation keys canonical (`args`, `kwargs`), consistent with `inspect.Parameter.name` and `__annotations__`.
- Normalize docstring field argument names only for lookup/deduplication:
  - `args` and `*args` identify the same `VAR_POSITIONAL` | edit | unknown | Luna baseline PASS |
| django__django-14997 | 2 | Inspect the SQLite schema remake bug described by the user. What is the minimal correct production fix and regression test strategy in this Django-era codebase? Focus on expression-based UniqueConstraint during _remake_table. | Material uncertainty: the exact failing operation/error is omitted. The likely defect is that `_remake_table()` rewrites field references for indexes but reuses `model._meta.constraints` unchanged. An expression-based `UniqueConstraint` can therefore retain the old field reference during a rename/remake.

### Minimal production fix

In `django/db/backends/sqlite3/schema.py`, when `alter_field` renames a field:

- Clone affected constraints rather than mutating model-state objects.
- Rewrite fiel | edit | unknown | Luna baseline PASS |

## Role-separated cost and usage

| Mode | Mean total cost | Median total cost | Executor input | Executor cached | Executor output | Advisor input | Advisor cached | Advisor output | Cost/success |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Luna | 0.0178 | 0.0179 | 804888 | 6069248 | 61796 | 0 | 0 | 0 | 0.0188 |
| Optional Advisor | 0.0845 | 0.0796 | 923438 | 7643136 | 80684 | 78209 | 0 | 28793 | 0.1126 |

- incremental cost vs same-experiment Luna: $0.0666 / attempt
- cost per additional success: undefined/infinite (no additional successes)
- configured executor cost (optional): 0.0217 / attempt
- configured Advisor cost (optional): 0.0627 / attempt

## Latency

- Luna median: 119.50s
- Optional Advisor median: 175.02s
- Luna p90: 194.85s
- Optional Advisor p90: 370.06s
- mean paired latency delta (optional - Luna): 69.72s
- median paired latency delta (optional - Luna): 35.03s
- Advisor-call latency contribution: N/A; the harness does not expose a separate call-duration event.

## Artifact reconciliation

- Results JSONL: /Users/philipbrembeck/.pi/agent/extensions/pi-advisor/benchmarks/swebench/results/exp-20260820-swebench-hard-optional-advisor-v1.jsonl (40 terminal records).
- Patch artifacts: 40, one per planned cell; empty patches remain represented with their recorded SHA-256.
- Runtime Advisor calls: 22; usage Advisor calls: 22.
- Scout calls: 0.
- All 40 cells were scorable and terminal; no setup/provider failures.

## Comparison with frozen Sol baseline

- Frozen Sol baseline: 16/20.
- Frozen Luna baseline: 16/20.
- This experiment re-runs Luna in the same temporal/provider window; historical frozen Luna is retained only as replication context.
- The frozen Sol-only and Luna-only task sets were not used for selection or treatment.

## Final interpretation

ADVISOR REGRESSION
