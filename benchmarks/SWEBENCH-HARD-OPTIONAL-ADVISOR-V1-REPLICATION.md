# SWE-bench Hard Optional Advisor v1 Replication

Results: `/Users/philipbrembeck/.pi/agent/extensions/pi-advisor/benchmarks/swebench/results/exp-20260822-swebench-hard-optional-advisor-v1-replication-v3.jsonl`
Experiment: `exp-20260822-swebench-hard-optional-advisor-v1-replication-v3`

## Frozen treatment identity

- Identity artifact: `benchmarks/swebench/artifacts/exp-20260822-swebench-hard-optional-advisor-v1-replication-v3/treatment-identity.json`
- Identity match gate: true
- Identity hash: 91ee0ed2f9d90a7392599441bd4c416b02e316a5f83800f7d975f8cb22855b80
- Current adapter hash/version: sha256:a7ad9c6803c56e9d7a01db5479e1b0bd91e1064c3ae2659ab6f402a17a428c77 / 2026-08-19.3
- Luna executor: openai-codex/gpt-5.6-luna
- Luna executor configuration hash: 427b45970f59e67b8f56fcc16eef8fc79c3b1467697ee05c19e6711a9655da56
- Sol Advisor: openai-codex/gpt-5.6-sol
- Sol Advisor configuration hash: f911bfe6b4a074e9a27028b9a1effd3beccaea46c78ab9336a5ceeec72e42143
- ask_advisor definition hash: sha256:009e4dab5d37678a59a859f04f2c51fdb5b1acf1e497e2ee8ec71050d219d9f8
- Advisor system/policy hashes: sha256:5b8403279a87226500ba5ee6fde54c8b8c053e9250edb80e388c2d66bf0cc6e1 / sha256:5e8402e70fc602b7965c9c1f64019af69c47e214d0d4f4dde72c43f0a3011d2b
- Executor task-prompt source hash: sha256:f69e576c57f380f369ddd25d75c96a7430fffe4ffae528efa08621d3725a2174
- Max Advisor calls: 4
- Validation lifecycle hash: sha256:5808337aa0be826838ff9203595114cc0b02ac21e8b287b9e285be1e3d83ee82
- Frozen manifest canonical/semantic SHA: 44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193 / f47a191590b8a39880a6770023035e812e8cae886b94a0f16e34e7c59dcbd588
- Candidate-pool SHA: 6282101e12dd1d79667de8f04e45554971d329c9be058b864186fb7394eb9dbb
- Treatment comparison: current identity was fail-closed against v1 model, policy, prompt-treatment, max-call, adapter, manifest, candidate-pool, and v1-runtime evidence.
- No Advisor implementation, Advisor prompt, Advisor policy, executor prompt, adapter, manifest, or treatment variant was changed for this replication.

## Randomized paired design and schedule

- Cohort: 20 frozen tasks × 2 modes × 3 repetitions = 120 executions.
- Primary unit: task × repetition pair; N = 60 pairs; unique tasks = 20.
- Modes: Luna and Luna + Optional Advisor only; no Sol baseline, Scout, or mandatory Advisor.
- Random seed: 20260822; concurrency: 4; schedule SHA: 1dec3578ce0da02ccf5223a1f5d07cb04d3fb00ebcb78b12fb1bc52ffaa0d4d0; plan SHA: 37a90c49754fb39ffbae51739e1de44e5dd0b6dd9397c5fdcab325600e9cefd1
- Preflight artifact: benchmarks/swebench/artifacts/hard-baseline-v2/preflight-baseline-gate-current.json (sha256:b9147c380ab4e77f0aac40a58db111edc766210eba50b2764b6cf704a9a87c6c); it was an immutable 20/20 ready gate reused after the v2 preflight operational stop. Model-state validation remained the unchanged adapter lifecycle for every execution.
- The reused gate covers the same manifest, adapter version, test/solution patches, repository environments, and validator lifecycle; no model, prompt, policy, timeout, concurrency, or task input changed.
- Each pair is a sequential two-cell block; pair blocks are globally shuffled. Pair members were not run concurrently.

| Pair | Task | Rep | First | Second | Luna | Optional Advisor | Outcome | Advisor calls |
| --- | --- | ---: | --- | --- | --- | --- | --- | ---: |
| pair-01-sympy__sympy-20049-r1 | sympy__sympy-20049 | 1 | luna | luna-advisor-optional | PASS | FAIL | luna-only | 2 |
| pair-02-django__django-13265-r2 | django__django-13265 | 2 | luna-advisor-optional | luna | PASS | FAIL | luna-only | 1 |
| pair-03-matplotlib__matplotlib-18869-r1 | matplotlib__matplotlib-18869 | 1 | luna-advisor-optional | luna | PASS | PASS | both-pass | 1 |
| pair-04-sphinx-doc__sphinx-8474-r1 | sphinx-doc__sphinx-8474 | 1 | luna-advisor-optional | luna | PASS | PASS | both-pass | 1 |
| pair-05-scikit-learn__scikit-learn-25747-r2 | scikit-learn__scikit-learn-25747 | 2 | luna | luna-advisor-optional | PASS | FAIL | luna-only | 0 |
| pair-06-sympy__sympy-16792-r1 | sympy__sympy-16792 | 1 | luna | luna-advisor-optional | PASS | PASS | both-pass | 2 |
| pair-07-sympy__sympy-21171-r3 | sympy__sympy-21171 | 3 | luna-advisor-optional | luna | FAIL | PASS | advisor-only | 0 |
| pair-08-django__django-14997-r2 | django__django-14997 | 2 | luna-advisor-optional | luna | PASS | FAIL | luna-only | 0 |
| pair-09-sphinx-doc__sphinx-8713-r2 | sphinx-doc__sphinx-8713 | 2 | luna | luna-advisor-optional | PASS | PASS | both-pass | 0 |
| pair-10-scikit-learn__scikit-learn-25747-r1 | scikit-learn__scikit-learn-25747 | 1 | luna | luna-advisor-optional | PASS | FAIL | luna-only | 1 |
| pair-11-django__django-11019-r1 | django__django-11019 | 1 | luna-advisor-optional | luna | FAIL | FAIL | both-fail | 0 |
| pair-12-matplotlib__matplotlib-25442-r3 | matplotlib__matplotlib-25442 | 3 | luna | luna-advisor-optional | PASS | PASS | both-pass | 1 |
| pair-13-sympy__sympy-21171-r2 | sympy__sympy-21171 | 2 | luna-advisor-optional | luna | PASS | FAIL | luna-only | 0 |
| pair-14-sympy__sympy-16792-r3 | sympy__sympy-16792 | 3 | luna-advisor-optional | luna | PASS | FAIL | luna-only | 0 |
| pair-15-django__django-16820-r3 | django__django-16820 | 3 | luna | luna-advisor-optional | PASS | PASS | both-pass | 0 |
| pair-16-matplotlib__matplotlib-18869-r2 | matplotlib__matplotlib-18869 | 2 | luna-advisor-optional | luna | PASS | PASS | both-pass | 1 |
| pair-17-sphinx-doc__sphinx-8474-r2 | sphinx-doc__sphinx-8474 | 2 | luna | luna-advisor-optional | PASS | FAIL | luna-only | 1 |
| pair-18-django__django-16820-r1 | django__django-16820 | 1 | luna-advisor-optional | luna | PASS | PASS | both-pass | 0 |
| pair-19-sphinx-doc__sphinx-10451-r3 | sphinx-doc__sphinx-10451 | 3 | luna | luna-advisor-optional | PASS | FAIL | luna-only | 1 |
| pair-20-matplotlib__matplotlib-18869-r3 | matplotlib__matplotlib-18869 | 3 | luna | luna-advisor-optional | FAIL | FAIL | both-fail | 0 |
| pair-21-matplotlib__matplotlib-22711-r2 | matplotlib__matplotlib-22711 | 2 | luna | luna-advisor-optional | FAIL | FAIL | both-fail | 0 |
| pair-22-scikit-learn__scikit-learn-14092-r2 | scikit-learn__scikit-learn-14092 | 2 | luna | luna-advisor-optional | FAIL | FAIL | both-fail | 0 |
| pair-23-django__django-14997-r1 | django__django-14997 | 1 | luna-advisor-optional | luna | FAIL | FAIL | both-fail | 0 |
| pair-24-scikit-learn__scikit-learn-25747-r3 | scikit-learn__scikit-learn-25747 | 3 | luna | luna-advisor-optional | FAIL | FAIL | both-fail | 0 |
| pair-25-sympy__sympy-20639-r3 | sympy__sympy-20639 | 3 | luna | luna-advisor-optional | FAIL | FAIL | both-fail | 0 |
| pair-26-sphinx-doc__sphinx-7686-r3 | sphinx-doc__sphinx-7686 | 3 | luna | luna-advisor-optional | FAIL | FAIL | both-fail | 1 |
| pair-27-sphinx-doc__sphinx-10451-r1 | sphinx-doc__sphinx-10451 | 1 | luna-advisor-optional | luna | FAIL | FAIL | both-fail | 1 |
| pair-28-sympy__sympy-20049-r3 | sympy__sympy-20049 | 3 | luna-advisor-optional | luna | FAIL | FAIL | both-fail | 0 |
| pair-29-matplotlib__matplotlib-25442-r1 | matplotlib__matplotlib-25442 | 1 | luna-advisor-optional | luna | PASS | FAIL | luna-only | 0 |
| pair-30-django__django-16820-r2 | django__django-16820 | 2 | luna-advisor-optional | luna | FAIL | FAIL | both-fail | 0 |
| pair-31-scikit-learn__scikit-learn-25638-r1 | scikit-learn__scikit-learn-25638 | 1 | luna-advisor-optional | luna | FAIL | FAIL | both-fail | 0 |
| pair-32-scikit-learn__scikit-learn-25638-r2 | scikit-learn__scikit-learn-25638 | 2 | luna | luna-advisor-optional | FAIL | FAIL | both-fail | 0 |
| pair-33-django__django-11019-r3 | django__django-11019 | 3 | luna | luna-advisor-optional | FAIL | FAIL | both-fail | 0 |
| pair-34-sympy__sympy-20639-r1 | sympy__sympy-20639 | 1 | luna | luna-advisor-optional | FAIL | FAIL | both-fail | 0 |
| pair-35-sympy__sympy-16792-r2 | sympy__sympy-16792 | 2 | luna-advisor-optional | luna | PASS | FAIL | luna-only | 0 |
| pair-36-scikit-learn__scikit-learn-15535-r1 | scikit-learn__scikit-learn-15535 | 1 | luna | luna-advisor-optional | FAIL | PASS | advisor-only | 0 |
| pair-37-django__django-13265-r3 | django__django-13265 | 3 | luna-advisor-optional | luna | PASS | FAIL | luna-only | 0 |
| pair-38-sphinx-doc__sphinx-10451-r2 | sphinx-doc__sphinx-10451 | 2 | luna | luna-advisor-optional | PASS | PASS | both-pass | 1 |
| pair-39-matplotlib__matplotlib-25442-r2 | matplotlib__matplotlib-25442 | 2 | luna | luna-advisor-optional | PASS | PASS | both-pass | 1 |
| pair-40-scikit-learn__scikit-learn-14092-r1 | scikit-learn__scikit-learn-14092 | 1 | luna-advisor-optional | luna | PASS | PASS | both-pass | 0 |
| pair-41-django__django-13265-r1 | django__django-13265 | 1 | luna | luna-advisor-optional | PASS | PASS | both-pass | 2 |
| pair-42-matplotlib__matplotlib-23964-r2 | matplotlib__matplotlib-23964 | 2 | luna-advisor-optional | luna | PASS | PASS | both-pass | 1 |
| pair-43-sphinx-doc__sphinx-8474-r3 | sphinx-doc__sphinx-8474 | 3 | luna-advisor-optional | luna | FAIL | FAIL | both-fail | 3 |
| pair-44-matplotlib__matplotlib-23964-r3 | matplotlib__matplotlib-23964 | 3 | luna-advisor-optional | luna | PASS | PASS | both-pass | 0 |
| pair-45-matplotlib__matplotlib-23964-r1 | matplotlib__matplotlib-23964 | 1 | luna | luna-advisor-optional | PASS | PASS | both-pass | 1 |
| pair-46-sphinx-doc__sphinx-7686-r1 | sphinx-doc__sphinx-7686 | 1 | luna | luna-advisor-optional | PASS | PASS | both-pass | 2 |
| pair-47-matplotlib__matplotlib-22711-r3 | matplotlib__matplotlib-22711 | 3 | luna | luna-advisor-optional | FAIL | PASS | advisor-only | 2 |
| pair-48-scikit-learn__scikit-learn-15535-r2 | scikit-learn__scikit-learn-15535 | 2 | luna-advisor-optional | luna | PASS | PASS | both-pass | 1 |
| pair-49-sphinx-doc__sphinx-7686-r2 | sphinx-doc__sphinx-7686 | 2 | luna | luna-advisor-optional | PASS | PASS | both-pass | 2 |
| pair-50-sympy__sympy-20639-r2 | sympy__sympy-20639 | 2 | luna | luna-advisor-optional | FAIL | FAIL | both-fail | 1 |
| pair-51-matplotlib__matplotlib-22711-r1 | matplotlib__matplotlib-22711 | 1 | luna | luna-advisor-optional | FAIL | FAIL | both-fail | 1 |
| pair-52-sphinx-doc__sphinx-8713-r1 | sphinx-doc__sphinx-8713 | 1 | luna-advisor-optional | luna | PASS | PASS | both-pass | 0 |
| pair-53-scikit-learn__scikit-learn-25638-r3 | scikit-learn__scikit-learn-25638 | 3 | luna-advisor-optional | luna | PASS | FAIL | luna-only | 1 |
| pair-54-django__django-14997-r3 | django__django-14997 | 3 | luna-advisor-optional | luna | PASS | FAIL | luna-only | 0 |
| pair-55-sphinx-doc__sphinx-8713-r3 | sphinx-doc__sphinx-8713 | 3 | luna | luna-advisor-optional | FAIL | PASS | advisor-only | 0 |
| pair-56-sympy__sympy-21171-r1 | sympy__sympy-21171 | 1 | luna | luna-advisor-optional | PASS | PASS | both-pass | 0 |
| pair-57-scikit-learn__scikit-learn-14092-r3 | scikit-learn__scikit-learn-14092 | 3 | luna-advisor-optional | luna | PASS | PASS | both-pass | 2 |
| pair-58-scikit-learn__scikit-learn-15535-r3 | scikit-learn__scikit-learn-15535 | 3 | luna | luna-advisor-optional | PASS | FAIL | luna-only | 0 |
| pair-59-django__django-11019-r2 | django__django-11019 | 2 | luna-advisor-optional | luna | PASS | FAIL | luna-only | 1 |
| pair-60-sympy__sympy-20049-r2 | sympy__sympy-20049 | 2 | luna-advisor-optional | luna | FAIL | PASS | advisor-only | 1 |

## Primary paired correctness

- Both pass: 21/60
- Advisor-only pass (Luna FAIL → Optional PASS): 5/60
- Luna-only pass (Luna PASS → Optional FAIL): 16/60
- Both fail: 18/60
- Advisor-only passes: 5; Luna-only passes: 16; discordant pairs: 21
- Exact two-sided paired McNemar/binomial-style p-value: 0.026604
- Assigned Luna pass rate: 61.7%; assigned Optional pass rate: 43.3%; net additional successes: -11
- The primary p-value uses 60 paired observations, not 60 independent tasks.
- Task-clustered interpretation: 2 tasks Advisor-better, 9 equal, 9 Luna-better; 11 unequal tasks; cluster sign-test p-value 0.065430. The effective task count remains 20.

## Assigned-treatment rescues and regressions

- Assigned-treatment rescue: 5 (control FAIL → Optional PASS, regardless of calls).
- Assigned-treatment regression: 16 (control PASS → Optional FAIL).
- Treatment failures with Advisor exposure: 12.
- Treatment failures without Advisor exposure: 22.
- Zero-call divergences (control PASS → Optional FAIL with zero calls): 9.
- A zero-call treatment failure is an assigned-mode regression, not an Advisor-attributable regression.

## Advisor-exposed rescue evidence

| Pair | Task | Advisor calls | Question | Response summary | Observable subsequent executor action |
| --- | --- | ---: | --- | --- | --- |
| pair-47-matplotlib__matplotlib-22711-r3 | matplotlib__matplotlib-22711 | 2 | Review the intended production fix for this RangeSlider bug. The current source mutates self.poly.xy[4], but axvspan/axhspan creates only 4 vertices when valinit endpoints are equal, causing IndexError. Should we remove the xy[4] assignments and also update handle positions in set_val, without touching benchmark tests? | Yes, update handle positions in `set_val`, but **do not merely delete the `xy[4]` assignments**. Construct a fresh four-corner vertex sequence and assign it through `self.poly.xy`/`set_xy`. `Polygon` will close it itself: ```python if self.orientation == "vertical": xy = [ (.25, val[0]), (.25, val[1]), (.75, val[1]), (.75, val[0]), ] self._handles[0].set_ydata([val[0]]) self._handles[1].set_ydata([val[1]]) else: xy = [ (val[0], .25), (val[0], .75), (val[1], .75), (val[1], .25), ] self._handles[0 | edit lib/matplotlib/widgets.py |
| pair-60-sympy__sympy-20049-r2 | sympy__sympy-20049 | 1 | Review the production fix for correctness and any missing edge cases relative to the requested Point.vel behavior. | The fix closely matches the prior SymPy behavior and the supplied test runs cover the main regression. Explicit velocities correctly take precedence, and BFS ensures the first selected anchor is at minimum graph distance. One material edge case remains: each traversed edge is validated with `neighbor_pos.express(frame)`, but the final displacement is recomputed using `self.pos_from(neighbor)`. That method may select a different shortest path containing an edge that cannot be expressed in `frame` | edit sympy/physics/vector/point.py |

## Advisor-exposed regressions and zero-call divergences

| Pair | Task | Calls | Classification | Question | Response summary | Subsequent action |
| --- | --- | ---: | --- | --- | --- | --- |
| pair-01-sympy__sympy-20049-r1 | sympy__sympy-20049 | 2 | treatment FAIL with Advisor exposure | Determine the minimal correct production fix for Point.vel() in this old SymPy repository. User explicitly expects Q.set_pos(P, r) then Q.vel(A) to return r.dt(A) even though P has no velocity set. Existing tests include older expectations that Q.vel(N) raises when parent velocity is undefined. How should implementation balance this, and what edge cases should be covered? | The explicit requested behavior supersedes the older test expecting `ValueError`; both cannot remain valid. Update that test rather than preserving contradictory semantics. Recommended minimal behavior in `Point.vel(frame)`: 1. Return an explicitly stored velocity unchanged. 2. Search positional neighbors for a path to a point with a known velocity, preferring the nearest such point. 3. If no anchored path exists but a direct position relation is differentiable in `frame`, treat that direct neig | edit sympy/physics/vector/point.py |
| pair-02-django__django-13265-r2 | django__django-13265 | 1 | treatment FAIL with Advisor exposure | We need fix a Django migration autodetector/schema editor bug: AlterOrderWithRespectTo must be ordered before AddIndex when an index includes the generated _order field. What code areas and regression tests should we inspect/change? | Focus on the migration autodetector, not the schema editor. `AlterOrderWithRespectTo.database_forwards()` is what creates `_order`; `AddIndex` must therefore follow it. ### Inspect - `django/db/migrations/autodetector.py` - The overall generation order in `_detect_changes()`, especially: - `generate_added_indexes()` - `generate_altered_order_with_respect_to()` - `generate_created_models()`, which may separately emit deferred operations for: - Foreign keys via `AddField` - `AlterOrderWithRespectT | bash rg -n "generate_(added_indexes\|altered_order\|created_models)\|order_with_respect_to\|AlterOrderWithRespectTo\|AddIndex" django/db/migrations/autodetector.py tests/migrations/test_autodetector.py |
| pair-05-scikit-learn__scikit-learn-25747-r2 | scikit-learn__scikit-learn-25747 | 0 | treatment FAIL without Advisor exposure | not captured | not captured | No Advisor call; not Advisor-attributable |
| pair-08-django__django-14997-r2 | django__django-14997 | 0 | treatment FAIL without Advisor exposure | not captured | not captured | No Advisor call; not Advisor-attributable |
| pair-10-scikit-learn__scikit-learn-25747-r1 | scikit-learn__scikit-learn-25747 | 1 | treatment FAIL with Advisor exposure | Review whether this is the correct minimal production fix for the reported FeatureUnion pandas aggregation bug, and identify any missing production changes or validation concerns. | The production change is likely the correct minimal fix: an already-indexed `DataFrame` should retain the transformer-defined index, while `index` remains applicable when constructing a new DataFrame from array-like output. No additional production change is apparent from the shown diff. Main concern: there is no regression test. Add coverage for: - `_wrap_in_pandas_container` preserving an existing DataFrame index even when a different `index` argument is supplied. - Preferably the reported `Fe | bash awk 'length($0)>88 {print NR ":" length($0) ":" $0}' sklearn/utils/_set_output.py \| head; git diff --check; git status --short |
| pair-13-sympy__sympy-21171-r2 | sympy__sympy-21171 | 0 | treatment FAIL without Advisor exposure | not captured | not captured | No Advisor call; not Advisor-attributable |
| pair-14-sympy__sympy-16792-r3 | sympy__sympy-16792 | 0 | treatment FAIL without Advisor exposure | not captured | not captured | No Advisor call; not Advisor-attributable |
| pair-17-sphinx-doc__sphinx-8474-r2 | sphinx-doc__sphinx-8474 | 1 | treatment FAIL with Advisor exposure | In this Sphinx repository at the pre-3.3 code state, diagnose the likely regression behind user report: upgrading to Sphinx 3.3 causes 'WARNING: no number is assigned for table' during singlehtml/latex builds. Identify the production fix and likely tests, based on the current code and history. | The broad history searches do not establish the fix. The strongest lead is that `singlehtml` and LaTeX both assemble documents through `inline_all_toctrees()`, unlike ordinary HTML. That path rewrites/prefixes node IDs. Figure numbering remains keyed in `env.toc_fignumbers` by the original document-local IDs, so a table label can resolve successfully while its rewritten ID has no matching number, producing: > no number is assigned for table Do **not** suppress the warning or add a fallback numbe | bash git log --all --since='2020-10-01' --until='2021-02-01' --oneline -G 'toc_fignumbers\|inline_all_toctrees\|assign_figure_numbers\|no number is assigned' -- sphinx tests CHANGES |
| pair-19-sphinx-doc__sphinx-10451-r3 | sphinx-doc__sphinx-10451 | 1 | treatment FAIL with Advisor exposure | Inspect the repository context and advise the minimal production fix for duplicated *args/**kwargs fields when autodoc_typehints='description', without changing tests. Focus on where field names are normalized and compatibility risks. | The minimal fix should be in `sphinx/ext/autodoc/typehints.py::modify_field_list()`, where existing `param`/`type` field names are matched against annotation keys. Normalize field-list argument names before storing/looking them up: ```python def normalize_argname(name: str) -> str: return name.lstrip('*') ``` Apply this consistently to names parsed from both: - `:param *args:` / `:param **kwargs:` - `:type *args:` / `:type **kwargs:` - typed parameter forms such as `:param int *args:` Annotation | bash find tests/roots -path '*typehints.py' -o -path '*typehints*' \| head -30 |
| pair-29-matplotlib__matplotlib-25442-r1 | matplotlib__matplotlib-25442 | 0 | treatment FAIL without Advisor exposure | not captured | not captured | No Advisor call; not Advisor-attributable |
| pair-35-sympy__sympy-16792-r2 | sympy__sympy-16792 | 0 | treatment FAIL without Advisor exposure | not captured | not captured | No Advisor call; not Advisor-attributable |
| pair-37-django__django-13265-r3 | django__django-13265 | 0 | treatment FAIL without Advisor exposure | not captured | not captured | No Advisor call; not Advisor-attributable |
| pair-53-scikit-learn__scikit-learn-25638-r3 | scikit-learn__scikit-learn-25638 | 1 | treatment FAIL with Advisor exposure | Review the production change for correctness and identify any missing validation or regression risks. | not captured | No subsequent executor action captured |
| pair-54-django__django-14997-r3 | django__django-14997 | 0 | treatment FAIL without Advisor exposure | not captured | not captured | No Advisor call; not Advisor-attributable |
| pair-58-scikit-learn__scikit-learn-15535-r3 | scikit-learn__scikit-learn-15535 | 0 | treatment FAIL without Advisor exposure | not captured | not captured | No Advisor call; not Advisor-attributable |
| pair-59-django__django-11019-r2 | django__django-11019 | 1 | treatment FAIL with Advisor exposure | Review this production fix for the reported three-way Media ordering warning. Check algorithm correctness and compatibility with the repository's existing tests; identify any necessary adjustment. | ### Necessary adjustment `graphlib.TopologicalSorter` is likely incompatible with this repository’s supported Python versions; `graphlib` was introduced in Python 3.9. `py_compile` doesn’t validate runtime imports on older supported interpreters. It also changes stable ordering for unrelated chains: ```python Media.merge(["a", "b"], ["c", "d"]) ``` `TopologicalSorter.static_order()` may produce `["a", "c", "b", "d"]` because it emits ready nodes in batches, while existing behavior/tests may expe | bash find django -iname '*topolog*' -o -iname '*ordered*'; grep -R "stable_topological\\|CyclicDependency" -n django \| head |

## Per-task three-repetition stability

| Task | Luna passes | Advisor passes | Advisor calls | Direction |
| --- | ---: | ---: | ---: | --- |
| django__django-11019 | 1 | 0 | 1 | Luna better |
| django__django-13265 | 3 | 1 | 3 | Luna better |
| django__django-14997 | 2 | 0 | 0 | Luna better |
| django__django-16820 | 2 | 2 | 0 | equal |
| matplotlib__matplotlib-18869 | 2 | 2 | 2 | equal |
| matplotlib__matplotlib-22711 | 0 | 1 | 3 | Advisor better |
| matplotlib__matplotlib-23964 | 3 | 3 | 2 | equal |
| matplotlib__matplotlib-25442 | 3 | 2 | 2 | Luna better |
| scikit-learn__scikit-learn-14092 | 2 | 2 | 2 | equal |
| scikit-learn__scikit-learn-15535 | 2 | 2 | 1 | equal |
| scikit-learn__scikit-learn-25638 | 1 | 0 | 1 | Luna better |
| scikit-learn__scikit-learn-25747 | 2 | 0 | 1 | Luna better |
| sphinx-doc__sphinx-10451 | 2 | 1 | 3 | Luna better |
| sphinx-doc__sphinx-7686 | 2 | 2 | 5 | equal |
| sphinx-doc__sphinx-8474 | 2 | 1 | 5 | Luna better |
| sphinx-doc__sphinx-8713 | 2 | 3 | 0 | Advisor better |
| sympy__sympy-16792 | 3 | 1 | 2 | Luna better |
| sympy__sympy-20049 | 1 | 1 | 3 | equal |
| sympy__sympy-20639 | 0 | 0 | 1 | equal |
| sympy__sympy-21171 | 2 | 2 | 0 | equal |

- Stable Luna tasks (0/3 or 3/3): 6; unstable Luna tasks: 14.
- Stable Advisor tasks (0/3 or 3/3): 7; unstable Advisor tasks: 13.
- Unstable means outcomes vary between repetitions within the same mode.

## Run-to-run variance

| Mode | 0/3 tasks | 1/3 tasks | 2/3 tasks | 3/3 tasks |
| --- | ---: | ---: | ---: | ---: |
| Luna | 2 | 3 | 11 | 4 |
| Luna + Optional Advisor | 5 | 6 | 7 | 2 |
- Tasks stochastic under repeated execution: Luna 14/20; Optional Advisor 13/20.

## Advisor selectivity

- Zero calls: 32; one call: 20; two calls: 7; three calls: 1; four calls: 0.
- Calls conditioned on control PASS: 21/37 exposed (56.8%), mean calls 0.73.
- Calls conditioned on control FAIL: 7/23 exposed (30.4%), mean calls 0.43.
- Calls conditioned on treatment PASS: 16/26 exposed (61.5%), mean calls 0.85.
- Calls conditioned on treatment FAIL: 12/34 exposed (35.3%), mean calls 0.44.
- Assignment and exposure are separate: every Optional run was assigned the tool, while only calls > 0 count as exposed.

## Cost

| Mode | Mean cost/attempt | Median cost/attempt | Cost/successful attempt | Executor mean | Sol Advisor mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| Luna | $0.0164 (n=49/60) | $0.0154 | $0.0177 (n=37) | $0.0164 | $0.0000 |
| Luna + Optional Advisor | $0.0548 (n=47/60) | $0.0369 | $0.0576 (n=25) | $0.0161 | $0.0392 |
- Paired incremental treatment cost on complete-cost pairs (n=40/60): $0.0458 per attempt.
- Descriptive difference of observed arm means (different missing-cost denominators): $0.0384 per attempt.
- Cost per net additional success: undefined/infinite (net additional successes <= 0 or incremental cost unavailable).
- Role-separated costs use recorded configured/provider usage; executor and Sol Advisor are not collapsed in the treatment row.

## Latency

| Mode | Median | P90 | Mean |
| --- | ---: | ---: | ---: |
| Luna | 172.43s | 946.48s | 341.36s |
| Luna + Optional Advisor | 319.16s | 952.29s | 434.78s |
- Paired latency delta (Optional − Luna): median 81.68s; p90 577.54s; mean 93.41s.
- Optional zero-call latency: median 403.82s; >=1-call latency: median 263.91s.

## Historical replication context

- Frozen historical Luna baseline: 16/20.
- Optional-v1 fresh Luna control: 19/20.
- New randomized replication Luna executions: 37/60; task-level mean pass count 12.33/20 equivalent.
- Historical experiments are context only and are not pooled into the primary causal estimate.

## Interpretation

1. Assignment effect: the observed attempt-level direction is negative (5 Advisor-only versus 16 Luna-only; p=0.026604), while the task-clustered direction is 2 better, 9 equal, and 9 worse across 20 tasks (p=0.065430); the preregistered high-variance rule therefore prevents a replicated-effect claim.
2. Exposure association: answered separately by exposed rescues, exposed regressions, and the zero-call divergence count; exposure is not randomized and is not causal evidence.
3. Cost/latency justification: answered separately by role-separated cost, incremental cost, and paired latency.

## Final decision

Decision rule applied without post-result tuning: if repeated-task stochasticity is at least 20 unstable task-mode cells, choose high run variance; otherwise require a positive paired direction plus no exposed-regression excess for positive; choose regression when exposed regressions exceed exposed rescues and assigned paired effect is negative; choose quality-neutral/cost-negative when net gain is at most one and incremental cost is positive; otherwise choose high run variance.

INCONCLUSIVE — HIGH RUN VARIANCE

## Artifact reconciliation

- Results JSONL: /Users/philipbrembeck/.pi/agent/extensions/pi-advisor/benchmarks/swebench/results/exp-20260822-swebench-hard-optional-advisor-v1-replication-v3.jsonl (120 terminal records).
- Pair blocks: 60; schedule cells: 120; patch artifacts: 120.
- Advisor calls from usage: 37; Advisor-exposed treatment runs: 28.
- Infrastructure/provider failures: 0.
