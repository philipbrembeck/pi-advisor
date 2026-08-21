# SWE-bench Hard Baseline v2 Report

Results: `/Users/philipbrembeck/.pi/agent/extensions/pi-advisor/benchmarks/swebench/results/exp-20260820-swebench-hard-baseline-v2.jsonl`
Experiment: `exp-20260820-swebench-hard-baseline-v2`

## Integrity and provenance

- Manifest canonical SHA: `44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193`
- Manifest semantic SHA: `f47a191590b8a39880a6770023035e812e8cae886b94a0f16e34e7c59dcbd588`
- Candidate-pool SHA: `6282101e12dd1d79667de8f04e45554971d329c9be058b864186fb7394eb9dbb`
- Plan SHA: `6ccafe35b9f6ac25313f5d9458eeee6ccfe013df8270536b01a237dafec70ad3`
- Schedule SHA: `a153b8e1f0f6acf41bd81fd5e33030221ab86d5bc719ac302b55fdeedf8b64b8`
- Benchmark repository commit: `156d3ca2dd435a4292484d32045068eec184d055`
- Adapter: `2026-08-19.3`
- Concurrency: 4
- Advisor: not run
- Scout: not run

## Primary paired task matrix

| Task | Repository | Sol | Luna | Pair outcome |
| --- | --- | --- | --- | --- |
| sympy__sympy-16792 | sympy/sympy | PASS | FAIL | sol-only |
| sphinx-doc__sphinx-8474 | sphinx-doc/sphinx | PASS | FAIL | sol-only |
| django__django-11019 | django/django | PASS | PASS | both-pass |
| sphinx-doc__sphinx-7686 | sphinx-doc/sphinx | PASS | PASS | both-pass |
| scikit-learn__scikit-learn-15535 | scikit-learn/scikit-learn | PASS | PASS | both-pass |
| matplotlib__matplotlib-25442 | matplotlib/matplotlib | PASS | PASS | both-pass |
| sympy__sympy-20639 | sympy/sympy | FAIL | FAIL | both-fail |
| sympy__sympy-20049 | sympy/sympy | PASS | PASS | both-pass |
| sphinx-doc__sphinx-10451 | sphinx-doc/sphinx | PASS | PASS | both-pass |
| scikit-learn__scikit-learn-25747 | scikit-learn/scikit-learn | FAIL | PASS | luna-only |
| django__django-16820 | django/django | PASS | PASS | both-pass |
| sympy__sympy-21171 | sympy/sympy | PASS | PASS | both-pass |
| scikit-learn__scikit-learn-14092 | scikit-learn/scikit-learn | PASS | PASS | both-pass |
| matplotlib__matplotlib-23964 | matplotlib/matplotlib | PASS | PASS | both-pass |
| django__django-13265 | django/django | FAIL | PASS | luna-only |
| matplotlib__matplotlib-18869 | matplotlib/matplotlib | PASS | PASS | both-pass |
| django__django-14997 | django/django | FAIL | PASS | luna-only |
| matplotlib__matplotlib-22711 | matplotlib/matplotlib | PASS | FAIL | sol-only |
| scikit-learn__scikit-learn-25638 | scikit-learn/scikit-learn | PASS | PASS | both-pass |
| sphinx-doc__sphinx-8713 | sphinx-doc/sphinx | PASS | PASS | both-pass |

### Pair totals

- both pass: 13
- Sol-only: 3
- Luna-only: 3
- both fail: 1
- unscorable: 0
- discordant pairs: 6

## Aggregate correctness

| Model | Success | Scorable | Correctness |
| --- | ---: | ---: | ---: |
| Sol | 16 | 20 | 80.0% |
| Luna | 16 | 20 | 80.0% |

- absolute percentage-point delta (Sol - Luna): 0.0 pp

## Repository breakdown

| Repository | Sol | Luna |
| --- | ---: | ---: |
| sympy/sympy | 3/4 | 2/4 |
| sphinx-doc/sphinx | 4/4 | 3/4 |
| django/django | 2/4 | 4/4 |
| scikit-learn/scikit-learn | 3/4 | 4/4 |
| matplotlib/matplotlib | 4/4 | 3/4 |

## Statistical comparison

- both-pass count: 13
- Sol-only count: 3
- Luna-only count: 3
- both-fail count: 1
- discordant pairs: 6
- exact two-sided McNemar/binomial sign-style p-value: 1.000000
- Interpretation: n=20 paired tasks is a small calibration sample; this is directional evidence, not a broad significance claim.

## Advisor-opportunity analysis (Sol PASS / Luna FAIL)

| Task | Repository | Luna failure | Failing invariant | Luna patch scope | Sol patch scope | Rescue assessment |
| --- | --- | --- | --- | --- | --- | --- |
| sympy__sympy-16792 | sympy/sympy | unknown | F......................................................                  [100%]
=================================== FAILURES ===================================
___________________ | none | sympy/utilities/codegen.py | likely-rescuable |
| sphinx-doc__sphinx-8474 | sphinx-doc/sphinx | unknown | FFFF.................................................................... [ 16%]
........................................................................ [ 32%]
.................... | sphinx/domains/std.py | sphinx/domains/std.py | possibly-rescuable |
| matplotlib__matplotlib-22711 | matplotlib/matplotlib | unknown | FF...................................................................... [ 77%]
.....................                                                    [100%]
==================== | lib/matplotlib/widgets.py | lib/matplotlib/widgets.py | possibly-rescuable |

## Luna-only cases

| Task | Repository | Luna result | Sol failure | Luna patch scope | Observation |
| --- | --- | --- | --- | --- | --- |
| scikit-learn__scikit-learn-25747 | scikit-learn/scikit-learn | PASS | regression | sklearn/utils/_set_output.py | canonical validation passes; Luna has an observable valid solution, while Sol failed regression |
| django__django-13265 | django/django | PASS | unknown | django/db/migrations/autodetector.py | canonical validation passes; Luna has an observable valid solution, while Sol failed unknown |
| django__django-14997 | django/django | PASS | unknown | django/db/backends/ddl_references.py | canonical validation passes; Luna has an observable valid solution, while Sol failed unknown |

## Failure taxonomy

| Failure type | Sol | Luna |
| --- | ---: | ---: |
| wrong-root-cause | 0 | 0 |
| incomplete-fix | 0 | 0 |
| incorrect-edge-case | 0 | 0 |
| regression | 1 | 0 |
| over-broad-patch | 0 | 0 |
| timeout | 0 | 0 |
| other | 0 | 0 |
| unknown | 3 | 4 |

## Efficiency and usage

| Model | Median duration | P90 duration | Mean duration | Model calls | Agent turns | Tool calls | Input tokens | Cached input | Output tokens | Total tokens | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Sol | 128.67s | 238.32s | 157.92s | 271 | 271 | 442 | 740215 | 4786688 | 55559 | 5582462 | $7.7612 |
| Luna | 118.98s | 202.11s | 123.83s | 357 | 357 | 451 | 778057 | 6216192 | 58880 | 7053129 | $0.3506 |

## Final decision

Sol correctness: 80.0%
Luna correctness: 80.0%
Delta: 0.0 pp

Both pass: 13
Sol-only: 3
Luna-only: 3
Both fail: 1
Unscorable: 0

Discordant pairs: 6
Statistical comparison: exact two-sided p=1.000000

Sol median duration: 128.67s
Luna median duration: 118.98s

Sol cost: $7.7612
Luna cost: $0.3506

Benchmark assessment: SUSPICIOUS BASELINE — INVESTIGATE
