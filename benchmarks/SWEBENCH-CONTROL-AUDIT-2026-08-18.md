# SWE-bench Control Audit — 2026-08-18

## 1. Executive finding

**D — multiple issues.**

The five canonical gold patches pass a fresh three-state replay; no defect
was reproduced under that replay. The completed 30-run control is nevertheless
**not trustworthy for model comparison**:

1. 11/30 validation attempts ended in `control-test-patch-apply` (Sol 6,
   Luna 5). These are unscorable patch-phase outcomes, not model correctness
   results under the requested audit protocol.
2. The historical result records imply that test-patch application occurred
   in a workspace that models had already edited. Every observed patch-apply
   failure overlaps a test file the model edited. This strongly supports, but
   does not alone prove, a lifecycle/worktree contamination defect; the
   validator does not guarantee a deterministic, model-independent fixture.
3. Sol's captured `PI_MODEL` environment value is stale (`gpt-5.6-luna`), even
   though the explicitly resolved executor model is Sol. This is a runtime
   fingerprint defect and is potentially observable by an agent.
4. The benchmark declares `temperature: 0`, but the effective runtime snapshot
   records `temperature: null` and no sampling parameters in provider requests
   for either model. This is a configuration/telemetry defect, not evidence by
   itself of a Sol/Luna bias.

**Advisor experiments remain blocked. The 20-task expansion is not executed.**
The existing aggregate is not reinterpreted as a model ranking.

Evidence limits: the historical SWE-bench adapter source and its validator
script are not present in this checkout; the P0 replay below reconstructs the
observed Django test-runner validator from the canonical dataset rows. The
historical result records and their validator hash remain the authoritative
record of what ran.

## 2. Gold-patch verification

Canonical data source: `princeton-nlp/SWE-bench_Lite`, `test` split, retrieved
2026-08-18 from the Hugging Face rows API. Repository: `django/django`.
Each state used a pristine worktree at the recorded base commit. The test patch
was applied first; State B then applied only the canonical reference patch.
State C reset to base and reapplied only the test patch.

Validator command used in the replay:

```text
PYTHONPATH=<workspace> python3 tests/runtests.py <task test module>
```

No patch was modified. All test and gold patch `git apply` operations were
checked with `git apply --check` before application. No timeout occurred.

| Task | Instance ID | Base commit | Initial | Gold | Reverted |
| --- | --- | --- | :---: | :---: | :---: |
| 15819 | `django__django-15819` | `877c800f255ccaa7abde1fb944de45d1616f5cc9` | FAIL | PASS | FAIL |
| 15902 | `django__django-15902` | `44c24bf02835323d5418512ebe8e76166739ebf8` | FAIL | PASS | FAIL |
| 15996 | `django__django-15996` | `b30c0081d4d8a31ab7dc7f72a4c7099af606ef29` | FAIL | PASS | FAIL |
| 16041 | `django__django-16041` | `6df9398cce063874ae4d59db126d4adacb0fa8d3` | FAIL | PASS | FAIL |
| 16046 | `django__django-16046` | `ec13e801b820614ff374cb0046092caab8d67249` | FAIL | PASS | FAIL |

Patch and test-manifest fingerprints:

| Task | Test patch SHA-256 | Gold patch SHA-256 | Test files | Gold files |
| --- | --- | --- | --- | --- |
| 15819 | `2e7a782b2dce4af4188bffd770b5042aa926db9021e67f03bedc95c3acd6559f` | `07d68979a689112f14cf682cb3896c72659818db8c319e2d3129c4b40b229c9f` | `tests/inspectdb/models.py`, `tests/inspectdb/tests.py` | `django/core/management/commands/inspectdb.py` |
| 15902 | `67a72edaa143f54f78a735eb2bb65b0cf3499eb9bc8a219c44b4aec52ce3333a` | `0bfbeb2d8f825240fe2e3601a0209a2f796647ef49f9ec172c67277d2efc7b6d` | `tests/forms_tests/tests/test_formsets.py` | `django/forms/formsets.py` |
| 15996 | `87d23dd5fed490af35e6a1dbe17dc8feb0add3d03170bb979eb6cad16cf8ce7b` | `22785bf20843d62c86def93bb508f4fe73b81bffc1be0a7eadafd2a09603c664` | `tests/migrations/test_writer.py` | `django/db/migrations/serializer.py` |
| 16041 | `1e39de162adde647a030caa139abaf09aedcbd2569dec3d6368f3f64b83a548f` | `7f05dbfefa4229f7ee6d23c098feea1513c246f8de25d8e6b300a6d9738f18ed` | `tests/forms_tests/tests/test_formsets.py` | `django/forms/formsets.py` |
| 16046 | `328eca7eac168e44c3a50e791dadde3ac74d3f3f79d92feecf7e3026aa786e00` | `79a88249dd118392c24a507b5f70b562218f0054b63b923a3bf2a05100761b93` | `tests/utils_tests/test_numberformat.py` | `django/utils/numberformat.py` |

The exact FAIL_TO_PASS and PASS_TO_PASS arrays are the canonical arrays in
`benchmarks/results/exp-20260818-swebench-control.provenance.json`:

| Task | FAIL_TO_PASS | PASS_TO_PASS count | PASS_TO_PASS array SHA-256 |
| --- | --- | ---: | --- |
| 15819 | `test_same_relations (inspectdb.tests.InspectDBTestCase)` | 18 | `c595a696d46c9b791de370792eca808f41640e46d786c3087f92d5f20da5500f` |
| 15902 | `Management forms are already rendered with the new div template.` | 112 | `a7b0d72da454a963c9736b2957afb8ddf387c8a4d68fe572fea6b12ab43b2975` |
| 15996 | `test_serialize_enum_flags (migrations.test_writer.WriterTests)` | 51 | `f03ed4b5f7a1f623b237720ea4d5f0536c94a57b274b2418f6a9143bd1efa6a2` |
| 16041 | `test_empty_permitted_ignored_empty_form (forms_tests.tests.test_formsets.FormsFormsetTestCase)`, `test_empty_permitted_ignored_empty_form (forms_tests.tests.test_formsets.Jinja2FormsFormsetTestCase)` | 113 | `d5d5e87ef8b5d84c8dcb7b8a2deb59066de3c1b092614f54957a4d2bd2be2688` |
| 16046 | `test_empty (utils_tests.test_numberformat.TestNumberFormat)` | 6 | `4585565c84ea4c0406f3de55f774f88ab9c9284494a7cd6ac99e8904ad8de614` |

The five gold PASS results satisfy the hard P0 prerequisite. They do not
clear the adapter/runtime gate because P1/P2 are not sound.

## 3. Test-patch and environment verification

### Historical control

| Metric | Sol | Luna |
| --- | ---: | ---: |
| Runs | 15 | 15 |
| `control-test-patch-apply` | 6 | 5 |
| Other validation failures | 4 | 3 |
| Passes | 5 | 7 |
| Timeouts | 0 | 0 |

The 11 patch failures were reported with exact errors such as:

```text
patch failed: tests/forms_tests/tests/test_formsets.py:179
patch does not apply
```

Observable edit timelines show model edits to the overlapping test files in
those runs, and the validator later reported patch application failure. The
safe classification is **patch-phase/unscorable**, not model correctness. This
is strong evidence for lifecycle/worktree contamination, but the missing
historical adapter source prevents proving the exact causal ordering. A
follow-up adapter fix must make patch application deterministic and record its
phase before validation; representative failed predictions must also be
replayed through the canonical SWE-bench lifecycle before assigning causal
blame. Malformed or conflicting patches must never be silently repaired.

### Canonical replay fingerprint

- Python: CPython 3.11.4 on macOS arm64.
- Django repository: `django/django`, each exact base commit in the P0 table.
- Python packages observed: `asgiref 3.12.1`, `sqlparse 0.6.0`, `Jinja2 3.1.6`.
- Database: Django test runner default SQLite configuration.
- Working directory: repository root for each pristine worktree.
- Test command: the task-specific Django test module above.
- Replay validator timeout: 300 seconds; all runs completed below 2 seconds.
- Historical benchmark validator timeout: 60 seconds.

The replay was identical across task states except for the intentionally
applied patch state. After test-patch application, repository status was
`M tests/inspectdb/models.py, M tests/inspectdb/tests.py` for 15819 and the
single test file listed above for each of 15902, 15996, 16041, and 16046. A
persisted container/image lock and exact dependency lock are not present, so
environment identity is not fully reproducible yet.

## 4. django-django-15996 differential analysis

Raw outcomes were Sol `0/3`, Luna `2/3`. One Luna failure is the patch-phase
failure and is not a model result.

| Rep | Sol observable trajectory | Luna observable trajectory | Earliest meaningful divergence |
| --- | --- | --- | --- |
| 0 | Inspected serializer/tests, probed enum behavior, ran targeted tests, edited production and test files, then ran the suite. Final validator failure was `B | A` instead of `A | B`. | Performed more Python-version and `_decompose` probing, made multiple serializer/test edits, then hit test-patch application failure. | Luna continued compatibility probing and made repeated edits before validation; the pair is not a clean model comparison because Luna's validator phase failed. |
| 1 | Inspected multiple Python/runtime variants, edited serializer/tests, ran targeted and full tests. Failed with the same reversed flag order. | Inspected enum behavior, made a production/test change, ran targeted tests, and passed the full 52-test writer suite. | Luna reached a passing trajectory after earlier targeted validation; Sol retained the reversed decomposition order. |
| 2 | Inspected serializer/tests and Python behavior, made four edits, ran repeated tests. Failed with the same reversed flag order. | Inspected and edited serializer/tests, ran targeted/full tests, and passed. | The observable final validation outcome diverged; no private reasoning is inferred, and final diff content was not persisted by the historical schema. |

## 5. 15996 comparison with the gold patch

Gold production scope: `django/db/migrations/serializer.py`, 15 added and 2
removed lines. The gold handles Flag decomposition while preserving the
expected member order and Python-version behavior.

- **Luna reps 1 and 2:** genuine valid fixes. The FAIL_TO_PASS test and all
  PASS_TO_PASS tests passed in the recorded validator, so Luna did solve the
  SWE-bench issue. Textual equality to the gold patch is not required.
- **Luna rep 0:** unscorable patch-phase failure.
- **Sol reps 0–2:** partially correct approach / incorrect edge-case
  handling. The concrete failure is stable: serialized flags are emitted as
  `B | A` while the test requires `A | B`. The root issue was recognized, but
  the implementation did not preserve required ordering.

The historical schema retains changed paths and diff bytes, but not final diff
contents or line-level additions/removals. Therefore alternative-vs-gold
semantic classification beyond the validator result is intentionally bounded.

## 6. django-django-16046 differential analysis

Outcomes were Sol `2/3`, Luna `3/3`.

- Reps 0 and 1: both models passed.
- Rep 2: Luna passed; Sol ended with
  `control-test-patch-apply` on `tests/utils_tests/test_numberformat.py`.

Thus the single apparent Sol FAIL / Luna PASS pair is not a valid capability
contrast. There is no clean Sol-invalid/Luna-valid pair for this task. The
historical evidence supports ordinary trajectory variance plus an
unscorable patch-phase event, not a systematic Luna advantage.

## 7. django-django-15902 counterexample

Sol passed `3/3`; Luna passed `2/3`.

The Luna-only failure (rep 1) was a genuine validator failure, not a timeout or
patch-apply error. The diagnostic was a `RemovedInDjango50Warning` while
rendering `formset.management_form`; the management form still used the
legacy default template. This is an incomplete or mis-targeted fix relative to
the gold patch, which adds `ManagementForm.template_name =
"django/forms/div.html"`.

This is the requested counterexample: Sol succeeds on all three repetitions
where Luna has one incomplete fix. It argues against a global runtime story,
but the control is still contaminated and too small for ranking.

## 8. Provider/runtime comparison

All 15 Sol/Luna pairs contain runtime snapshots. After normalizing only
per-run IDs, temporary workspace paths, and session paths:

| Field | Sol | Luna | Assessment |
| --- | --- | --- | --- |
| Requested/resolved model | `openai-codex/gpt-5.6-sol` | `openai-codex/gpt-5.6-luna` | Intended treatment difference |
| Provider/API | `openai-codex` / `openai-codex-responses` | same | Equal |
| Context/max output | 272000 / 128000 | same | Equal |
| Reasoning | medium capability, high `PI_REASONING_LEVEL` | same | Equal in snapshot |
| Effective provider fields | `parallel_tool_calls: true`, `tool_choice: auto` | same | Equal |
| Tool definitions/availability | same four tools | same | Equal |
| Timeout/retry/compaction | 600s / no retry / disabled | same | Equal |
| Declared temperature | 0 | 0 | Equal declaration |
| Captured effective temperature | `null` | `null` | Configuration not transmitted/observed |
| `PI_MODEL` environment | stale `gpt-5.6-luna` | `gpt-5.6-luna` | Sol fingerprint defect; fix before rerun |
| Run/workspace/session IDs | different | different | Required isolation, not treatment |

The resolved model and provider request fields show no direct model-routing
mistake. The stale Sol environment variable remains a fairness and
reproducibility defect because the agent can inspect environment variables.
Sampling must be fixed or explicitly declared provider-controlled before the
next comparison.

## 9. Agent-work comparison

The following are descriptive distributions from all 15 settled runs per
model. Values are `mean / median / p90 / max`; duration is milliseconds.

| Observable | Sol | Luna |
| --- | --- | --- |
| Agent turns | 15.5 / 17 / 20 / 23 | 20.6 / 18 / 29 / 34 |
| Model calls | 15.5 / 17 / 20 / 23 | 20.6 / 18 / 29 / 34 |
| Input tokens | 41292 / 38488 / 53410 / 83306 | 40568 / 38059 / 47869 / 75760 |
| Output tokens | 3268 / 3399 / 4248 / 6226 | 3590 / 3385 / 5612 / 6338 |
| Cached tokens | 274193 / 214016 / 445952 / 625152 | 333380 / 308736 / 611840 / 716800 |
| Tool calls | 24.8 / 24 / 33 / 36 | 25.0 / 21 / 37 / 45 |
| File reads | 7.1 / 6 / 12 / 18 | 6.8 / 6 / 9 / 16 |
| Edits | 2.6 / 2 / 3 / 4 | 3.6 / 3 / 5 / 7 |
| Tests executed | 7.5 / 6 / 10 / 11 | 8.0 / 8 / 10 / 15 |
| Duration | 105429 / 97371 / 169329 / 174565 | 97962 / 86771 / 146227 / 176794 |

Success/failure comparison does not support a causal budget claim. Sol
successes had median 17 turns and 2 edits; Sol failures had median 15 turns
and 3 edits. Luna successes had median 19 turns and 3 edits; Luna failures had
median 15.5 turns and 3.5 edits. The sample is confounded by patch-phase
failures and task identity.

## 10. Patch-scope comparison

Exact final LOC counts are unavailable: the historical result schema stores
changed paths and `diffBytes`, not line additions/removals, and the test patch
was applied in the model workspace. Changed-file counts therefore include
benchmark test files and, in some runs, SQLite artifacts.

| Group | n | Median changed files | Median diff bytes |
| --- | ---: | ---: | ---: |
| Sol PASS | 5 | 2 | 1173 |
| Sol genuine FAIL | 4 | 2 | 2134 |
| Sol patch-phase FAIL | 6 | 2.5 | 2024.5 |
| Luna PASS | 7 | 2 | 2067 |
| Luna genuine FAIL | 3 | 3 | 2934 |
| Luna patch-phase FAIL | 5 | 2 | 2529 |

Gold production patches touch one file. The recorded two-file successful
scope is expected because the test patch touches a second file; it cannot be
used as evidence of model over-editing. Add a pre-edit workspace hash and a
post-model/pre-test-patch diff to the adapter before using patch scope.

## 11. Failure taxonomy

All 18 historical failures are counted, but patch-phase failures are kept
separate from model failures.

| Failure class | Sol | Luna | Tasks |
| --- | ---: | ---: | --- |
| Patch-phase / infrastructure-unscorable | 6 | 5 | 15819, 15996, 16041, 16046 |
| Incomplete / incorrect edge case | 3 | 1 | Sol 15996; Luna 15902 |
| Regression / over-broad fix | 1 | 2 | 15819 |
| Wrong root cause | 0 | 0 | — |
| Environment failure | 0 | 0 | — |
| Agent termination failure | 0 | 0 | — |
| Correct implementation / validator mismatch | 0 | 0 | — |
| Unknown | 0 | 0 | — |

The 15819 genuine failures show existing inspectdb behavior regressions in
`test_attribute_name_not_python_keyword`. The 15996 Sol failures have the
specific ordering error above. The Luna 15902 failure has the specific legacy
template warning above. No timeout occurred.

## 12. Control sample-size assessment

The raw paired table is 4 both pass, 1 Sol-only, 3 Luna-only, and 7 both fail.
Those are 15 executions but only five independent task instances. Only eight
pairs have no patch-phase invariant on either side; those pairs are 4 both
pass, 2 Luna-only, 1 Sol-only, and 1 both fail. Excluding records after
observing outcomes is not used as a new performance estimate.

Task identity dominates the observed direction: 15902 favors Sol, 15996
favors Luna on valid runs, 16046 has no clean Luna-exclusive failure pair, and
15819/16041 contribute no valid successes. Three repetitions do not turn each
problem into three independent samples. The five-task control is therefore
underpowered, but underpowered is not the current decision gate because the
adapter/runtime defects must be fixed first.

## 13. Decision and next action

**Decision: D — multiple issues.**

- The P0 gold-patch prerequisite passed for all five tasks under the fresh
  reconstructed replay; this does not prove byte-for-byte identity with the
  unavailable historical validator.
- The control itself is not yet trustworthy because patch application is not a
  deterministic, separately recorded phase and runtime fingerprints contain
  defects.
- The historical Sol/Luna result is not interpreted as a general capability
  ranking.
- **Advisor experiments remain blocked.** Do not run
  `luna-advisor-optional`, `luna-advisor-mandatory`, `luna-advisor-scout`, or
  `advisor-guidance`.
- **Do not execute the 20-task expansion yet.**

Next action, in order:

1. Fix the SWE-bench adapter lifecycle so each run records a pristine base
   hash, applies and verifies the test patch in a deterministic isolated phase,
   and classifies patch failures before model correctness.
2. Persist pre-model and post-model/pre-validation diffs, exact LOC counts,
   environment fingerprints, and effective provider request settings. Set
   `PI_MODEL` consistently with the resolved executor model.
3. Replay representative historical patch-conflict predictions through the
   canonical SWE-bench lifecycle and rerun the five-task control for both
   models.
4. Only if the rerun clears these gates, expand to the predeclared
   `20 unique tasks × 2 models × 1 repetition`, with a frozen hashed manifest.

Reproduction sources and commands: the canonical rows were retrieved from
`https://datasets-server.huggingface.co/rows?dataset=princeton-nlp%2FSWE-bench_Lite&config=default&split=test`; historical summaries are in
`benchmarks/results/exp-20260818-swebench-control.{json,jsonl,provenance.json}`;
the repository checks were `bun test`, `bun run typecheck`, and
`git -c diff.stat=false diff --no-ext-diff --check`.
