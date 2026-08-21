# SWE-bench Hard Baseline v2 Preflight Audit

Inference-free audit of the frozen 20-task manifest. No Sol, Luna, Advisor, Scout, schedule, or model execution was run.

## 1. Initial failure matrix

The pre-fix matrix is preserved in `benchmarks/swebench/artifacts/hard-baseline-v2/preflight.json`; exact phase diagnostics from the first rerun are in `preflight-initial-diagnostics.jsonl`. The recorded result was 4/20 ready.

| Task | Repo | Checkout | Test Patch | Initial | Gold Patch | Gold Validation | Reverted | Environment | Ready |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sympy__sympy-16792 | sympy | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| sphinx-doc__sphinx-8474 | sphinx-doc | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| django__django-11019 | django | PASS | PASS | FAIL | PASS | PASS | FAIL | COMPLETE | YES |
| sphinx-doc__sphinx-7686 | sphinx-doc | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| scikit-learn__scikit-learn-15535 | scikit-learn | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| matplotlib__matplotlib-25442 | matplotlib | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| sympy__sympy-20639 | sympy | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| sympy__sympy-20049 | sympy | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| sphinx-doc__sphinx-10451 | sphinx-doc | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | INCOMPLETE | NO |
| scikit-learn__scikit-learn-25747 | scikit-learn | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| django__django-16820 | django | PASS | PASS | FAIL | PASS | PASS | FAIL | COMPLETE | YES |
| sympy__sympy-21171 | sympy | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| scikit-learn__scikit-learn-14092 | scikit-learn | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| matplotlib__matplotlib-23964 | matplotlib | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| django__django-13265 | django | PASS | PASS | FAIL | PASS | PASS | FAIL | COMPLETE | YES |
| matplotlib__matplotlib-18869 | matplotlib | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| django__django-14997 | django | PASS | PASS | FAIL | PASS | PASS | FAIL | COMPLETE | YES |
| matplotlib__matplotlib-22711 | matplotlib | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| scikit-learn__scikit-learn-25638 | scikit-learn | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |
| sphinx-doc__sphinx-8713 | sphinx-doc | PASS | PASS | FAIL | FAIL | FAIL | FAIL | COMPLETE | NO |

## 2. Failure taxonomy

| Failure class | Count |
| --- | ---: |
| dependency-missing | 6 |
| native-build-failure | 24 |
| unknown | 21 |

| Failure class | Django | Matplotlib | scikit-learn | Sphinx | SymPy |
| --- | ---: | ---: | ---: | ---: | ---: |
| dependency-missing | 0 | 0 | 0 | 0 | 0 |
| native-build-failure | 0 | 12 | 12 | 0 | 0 |
| unknown | 8 | 0 | 0 | 0 | 8 |

## 3. Repository adapter findings

| Repository | Checkout/runtime | Dependency setup | Test runner / selector | Native/build | Cleanup |
| --- | --- | --- | --- | --- | --- |
| django | detached checkout | `tests/runtests.py` with manifest selectors; SQLite test DB. | Detached base commit; isolated uv Python 3.11 env; asgiref/pytz/sqlparse. `tests/runtests.py` with manifest selectors; SQLite test DB. | repository-specific | worktree removal; generated files remain outside prepared tree |
| matplotlib | detached checkout | `python -m pytest -q lib/...` selectors | Detached base commit; isolated env with pytest, NumPy, Pillow, date/plot dependencies. `python -m pytest -q lib/...` selectors. C extensions are not built on host. | repository-specific | worktree removal; generated files remain outside prepared tree |
| scikit-learn | detached checkout | `python -m pytest` selectors | Detached base commit; isolated env with pytest, NumPy, SciPy, joblib, threadpoolctl, Cython 0.29.37. `python -m pytest` selectors. OpenMP disabled explicitly; source extensions still require build. | repository-specific | worktree removal; generated files remain outside prepared tree |
| sphinx | detached checkout | `python -m pytest -q` selectors. | Detached base commit; isolated env with version-sensitive Sphinx test dependencies and plugin pins. `python -m pytest -q` selectors. | repository-specific | worktree removal; generated files remain outside prepared tree |
| sympy | detached checkout | `python -m pytest -q` selectors. | Detached base commit; isolated env with pytest, mpmath 1.3.0. `python -m pytest -q` selectors. | repository-specific | worktree removal; generated files remain outside prepared tree |

## 4. Environment changes

- Added per-adapter isolated uv environments and persisted adapter/environment fingerprints.
- Removed reliance on global pytest and package state.
- Added Django `asgiref`; pinned legacy Sphinx test dependencies by repository version; pinned Cython for legacy scikit-learn.
- Set `PYTHONPATH`, `PYTHONDONTWRITEBYTECODE`, `MPLBACKEND=Agg`, BLAS/OpenMP thread limits, and `SKLEARN_NO_OPENMP=1`.

## 5. Validator/selector fixes

- Validators now execute with the adapter-selected Python interpreter while preserving non-Python commands.
- Canonical test patches stage newly added files before file-set comparison; this fixes Sphinx task 10451.
- Validation records exact command, exit code, timing, stdout/stderr summaries, timeout, and failure class.
- The manifest test selectors and gold patches were not changed.

## 6. Regression tests added

- Existing SWE-bench lifecycle tests continue to cover protected test mutation, invalid test patch rejection, identity, timeout, and scorable classification.
- `benchmarks/test/swebench-adapters.test.ts` verifies explicit routing for all five repositories and preserves canonical selectors/patch payloads.
- Real frozen-task preflight exercised all five repository adapters and persisted initial/final phase evidence.

## 7. Final full preflight matrix

| Task | Repo | Checkout | Test Patch | Initial | Gold Patch | Gold Validation | Reverted | Environment | Ready |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sympy__sympy-16792 | sympy/sympy | PASS | PASS | FAIL (unknown) | PASS | PASS | FAIL (unknown) | PASS | YES |
| sphinx-doc__sphinx-8474 | sphinx-doc/sphinx | PASS | PASS | FAIL (unknown) | PASS | FAIL (unknown) | FAIL (unknown) | PASS | NO |
| django__django-11019 | django/django | PASS | PASS | FAIL (unknown) | PASS | PASS | FAIL (unknown) | PASS | YES |
| sphinx-doc__sphinx-7686 | sphinx-doc/sphinx | PASS | PASS | FAIL (dependency-missing) | PASS | FAIL (dependency-missing) | FAIL (dependency-missing) | PASS | NO |
| scikit-learn__scikit-learn-15535 | scikit-learn/scikit-learn | PASS | PASS | FAIL (native-build-failure) | PASS | FAIL (native-build-failure) | FAIL (native-build-failure) | PASS | NO |
| matplotlib__matplotlib-25442 | matplotlib/matplotlib | PASS | PASS | FAIL (native-build-failure) | PASS | FAIL (native-build-failure) | FAIL (native-build-failure) | PASS | NO |
| sympy__sympy-20639 | sympy/sympy | PASS | PASS | FAIL (unknown) | PASS | PASS | FAIL (unknown) | PASS | YES |
| sympy__sympy-20049 | sympy/sympy | PASS | PASS | FAIL (unknown) | PASS | PASS | FAIL (unknown) | PASS | YES |
| sphinx-doc__sphinx-10451 | sphinx-doc/sphinx | PASS | PASS | FAIL (unknown) | PASS | PASS | FAIL (unknown) | PASS | YES |
| scikit-learn__scikit-learn-25747 | scikit-learn/scikit-learn | PASS | PASS | FAIL (native-build-failure) | PASS | FAIL (native-build-failure) | FAIL (native-build-failure) | PASS | NO |
| django__django-16820 | django/django | PASS | PASS | FAIL (unknown) | PASS | PASS | FAIL (unknown) | PASS | YES |
| sympy__sympy-21171 | sympy/sympy | PASS | PASS | FAIL (unknown) | PASS | PASS | FAIL (unknown) | PASS | YES |
| scikit-learn__scikit-learn-14092 | scikit-learn/scikit-learn | PASS | PASS | FAIL (native-build-failure) | PASS | FAIL (native-build-failure) | FAIL (native-build-failure) | PASS | NO |
| matplotlib__matplotlib-23964 | matplotlib/matplotlib | PASS | PASS | FAIL (native-build-failure) | PASS | FAIL (native-build-failure) | FAIL (native-build-failure) | PASS | NO |
| django__django-13265 | django/django | PASS | PASS | FAIL (unknown) | PASS | PASS | FAIL (unknown) | PASS | YES |
| matplotlib__matplotlib-18869 | matplotlib/matplotlib | PASS | PASS | FAIL (native-build-failure) | PASS | FAIL (native-build-failure) | FAIL (native-build-failure) | PASS | NO |
| django__django-14997 | django/django | PASS | PASS | FAIL (unknown) | PASS | PASS | FAIL (unknown) | PASS | YES |
| matplotlib__matplotlib-22711 | matplotlib/matplotlib | PASS | PASS | FAIL (native-build-failure) | PASS | FAIL (native-build-failure) | FAIL (native-build-failure) | PASS | NO |
| scikit-learn__scikit-learn-25638 | scikit-learn/scikit-learn | PASS | PASS | FAIL (native-build-failure) | PASS | FAIL (native-build-failure) | FAIL (native-build-failure) | PASS | NO |
| sphinx-doc__sphinx-8713 | sphinx-doc/sphinx | PASS | PASS | FAIL (dependency-missing) | PASS | FAIL (dependency-missing) | FAIL (dependency-missing) | PASS | NO |

- Initial ready: 4/20
- Final ready: 9/20
- Gold lifecycle: 9/20

## 8. Remaining unsupported tasks

- 11 tasks remain blocked by Sphinx compatibility and legacy Matplotlib/scikit-learn native-extension requirements on this macOS arm64/Python 3.11 host.
- No task was replaced. No manifest or selection algorithm was changed.

## 9. Manifest integrity

Expected manifest SHA-256: `44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193`
Observed manifest SHA-256: `e6d7f25bd887e8bd59fa1cb76ce768e4da38299687899671ce4e1bd2ccec3e5b`

The task IDs and ordering match the supplied list, but the byte hash does not. Per protocol, this is an integrity stop; the manifest was not modified by this audit.

## Final gate

Inference run: **NO**

**MANIFEST INTEGRITY FAILURE**

## 10. Continuation after semantic identity audit

The historical raw-byte mismatch above is superseded by the completed identity audit. The frozen manifest, candidate pool, task order, task definitions, and selection provenance remain unchanged under the authoritative canonical and semantic definitions.

### Current starting point

`9/20 Ready`, from `benchmarks/swebench/artifacts/hard-baseline-v2/preflight-after-identity.json`. No model inference was performed for that baseline.

### Remaining failure matrix at the clean starting point

| Instance | Repository | Failing phase | Exit | Timeout | Classification | Diagnostic summary |
| --- | --- | --- | ---: | --- | --- | --- |
| sphinx-doc__sphinx-8474 | Sphinx | initial, gold, reverted | 1 | no | unknown | Sphinx 3.4 test output and numfig warnings differed under the unpinned legacy dependency set. |
| sphinx-doc__sphinx-7686 | Sphinx | initial, gold, reverted | 1 | no | dependency-missing | `alabaster` required Sphinx 3.4 while the checkout was Sphinx 3.1. |
| scikit-learn__scikit-learn-15535 | scikit-learn | initial, gold, reverted | 4 | no | native-build-failure | Source checkout could not import because scikit-learn extensions were not built. |
| matplotlib__matplotlib-25442 | Matplotlib | initial, gold, reverted | 4 | no | native-build-failure | Source checkout could not import because Matplotlib extensions were not built. |
| scikit-learn__scikit-learn-25747 | scikit-learn | initial, gold, reverted | 1 | no | native-build-failure | Legacy source extensions were unavailable under the pre-build adapter. |
| matplotlib__matplotlib-23964 | Matplotlib | initial, gold, reverted | 4 | no | native-build-failure | Legacy source extensions were unavailable under the pre-build adapter. |
| matplotlib__matplotlib-18869 | Matplotlib | initial, gold, reverted | 4 | no | native-build-failure | Legacy source extensions were unavailable under the pre-build adapter. |
| matplotlib__matplotlib-22711 | Matplotlib | initial, gold, reverted | 4 | no | native-build-failure | Legacy source extensions were unavailable under the pre-build adapter. |
| scikit-learn__scikit-learn-25638 | scikit-learn | initial, gold, reverted | 1 | no | native-build-failure | Legacy source extensions were unavailable under the pre-build adapter. |
| sphinx-doc__sphinx-8713 | Sphinx | initial, gold, reverted | 1 | no | dependency-missing | `sphinxcontrib.htmlhelp` required a newer Sphinx than the checkout. |
| sphinx-doc__sphinx-10451 | Sphinx | test patch/setup | setup | no | test-patch-apply | Canonical test-file matching rejected a multi-file selector payload before the adapter fix. |

### Root-cause clusters

- **Native source builds:** Matplotlib and scikit-learn needed repository build extensions, OpenMP-disabled scikit-learn compilation, legacy NumPy, and Matplotlib's bundled FreeType workaround.
- **Legacy Sphinx dependencies:** Sphinx-version-aware pins were required for `alabaster`, `docutils`, `sphinxcontrib-htmlhelp`, and `sphinxcontrib-serializinghtml`.
- **Selector translation:** Pytest validation now executes the union of canonical FAIL_TO_PASS and PASS_TO_PASS selectors. Truncated parameterized node IDs are normalized to their test function, and bare SymPy test names are resolved against the declared test files. Django keeps its canonical module-level test-runner invocation.
- **Generated build artifacts:** Native build outputs are isolated per workspace. Gold/reverted worktrees reuse only generated native artifacts from the prepared workspace before rebuilding; they never alter canonical patches or test files.

### Adapter and environment changes

- Bumped repository adapter version to `2026-08-19.3`.
- Persisted environment markers with requested Python, dependency specifications, installed-package freeze, adapter version, and environment fingerprint.
- Used the Homebrew arm64 Python 3.11 interpreter for native-build repositories and the configured `python3` interpreter for the remaining repositories.
- Added reproducible native build commands: `setup.py build_ext --inplace`, `SKLEARN_NO_OPENMP=1`, Matplotlib `CFLAGS=-DByte=uint8_t`, and `SETUPTOOLS_SCM_PRETEND_VERSION=0.0.0`.
- Added pandas for scikit-learn nullable/pandas selectors and build-time packages required by Matplotlib.
- Preserved isolated worktrees, exact canonical patch application, generated-artifact isolation, and the base → test patch → initial fail → gold pass → reverted fail lifecycle.

### Repository readiness

| Repository | Ready |
| --- | ---: |
| Django | 4/4 |
| Matplotlib | 4/4 |
| scikit-learn | 4/4 |
| Sphinx | 4/4 |
| SymPy | 4/4 |

### Final full 20-task preflight

A fresh full run was recorded at `benchmarks/swebench/artifacts/hard-baseline-v2/preflight-final-continuation-v3.json`. It used one frozen manifest, adapter `2026-08-19.3`, one environment configuration set, and fresh isolated workspaces for all tasks.

Result: **20/20 Ready**.

### Determinism sample

The mechanical sample selected the first task from each repository in manifest order:

1. `sympy__sympy-16792`
2. `sphinx-doc__sphinx-8474`
3. `django__django-11019`
4. `scikit-learn__scikit-learn-15535`
5. `matplotlib__matplotlib-25442`

Fresh repeat: **5/5 Ready**, recorded at `benchmarks/swebench/artifacts/hard-baseline-v2/preflight-determinism-sample-final.json`.

### Manifest and candidate integrity

| Identity | Expected | Observed | Status |
| --- | --- | --- | --- |
| Canonical manifest SHA | `44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193` | `44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193` | PASS |
| Semantic manifest SHA | `f47a191590b8a39880a6770023035e812e8cae886b94a0f16e34e7c59dcbd588` | `f47a191590b8a39880a6770023035e812e8cae886b94a0f16e34e7c59dcbd588` | PASS |
| Candidate-pool SHA | `6282101e12dd1d79667de8f04e45554971d329c9be058b864186fb7394eb9dbb` | `6282101e12dd1d79667de8f04e45554971d329c9be058b864186fb7394eb9dbb` | PASS |

### Automated validation

- `bun test`: **181 passed**
- `bun run typecheck`: **PASS**
- `bun run lint`: **PASS**
- `git diff --check`: **PASS**

### Remaining limitations

- The preflight is validated on this macOS arm64 host with the recorded Python/toolchain configuration; portability to another host requires a new environment fingerprint and preflight.
- No baseline provider execution was started.

### Final gate

Inference run: **NO**

**READY FOR BASELINE EXECUTION REVIEW**
