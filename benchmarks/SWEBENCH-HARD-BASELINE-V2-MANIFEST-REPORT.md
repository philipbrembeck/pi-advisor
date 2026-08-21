# SWE-bench Hard Baseline v2 Manifest Report

## Protocol transition

- v1 failure: protocol feasibility failure; 243/243 eligible tasks changed exactly one production file, making multi-module >=2 impossible.
- v1 effective identity: `aaf2d5e678aac2ec121c42ed0d1f72b024194bc2fe825748cf1baa1865187443`
- v1 clarification SHA: `8c055469c1f505e7faa81f12dbedbf0e2a95e0eaebe1a18e527ee766ff1c2878`
- v1 module-mapping SHA: `e59d066c06ea521fbf66f70ee20092b423b2c180c4070c8b590d0e6912e8e0d2`
- v2 protocol SHA: `88520ab8e2a4570dd2794cdc0e206c4155b891d25886229f9aa5bf982ecab436`
- effective v2 protocol identity: `b2a03210d4cda45e8065565580010b49f9bfcd5b40d8e160a4ad0ddfdb1e0355`
- No model inference occurred before v2 definition or manifest freeze.

## Candidate pool

- Dataset: `princeton-nlp/SWE-bench_Lite`, config `default`, split `test`
- Revision: `6ec7bb89b9342f664a54a6e0a6ea6501d3437cc2`
- Source rows: 300
- Eligible rows: 243 (Django 110, Matplotlib 19, scikit-learn 23, Sphinx 15, SymPy 76)
- Candidate-pool SHA: `6282101e12dd1d79667de8f04e45554971d329c9be058b864186fb7394eb9dbb`
- Candidate-pool reused: yes

## Candidate distribution

`243/243 eligible tasks modify exactly one production file`.

## v2 selection

- sympy__sympy-16792
- sphinx-doc__sphinx-8474
- django__django-11019
- sphinx-doc__sphinx-7686
- scikit-learn__scikit-learn-15535
- matplotlib__matplotlib-25442
- sympy__sympy-20639
- sympy__sympy-20049
- sphinx-doc__sphinx-10451
- scikit-learn__scikit-learn-25747
- django__django-16820
- sympy__sympy-21171
- scikit-learn__scikit-learn-14092
- matplotlib__matplotlib-23964
- django__django-13265
- matplotlib__matplotlib-18869
- django__django-14997
- matplotlib__matplotlib-22711
- scikit-learn__scikit-learn-25638
- sphinx-doc__sphinx-8713

## Coverage

- Preserved expression (`productionFilesChanged >= 2 OR productionLinesChanged >= 20`): 11 (required >=8)
- Effective observed `productionLinesChanged >= 20`: 11
- `FAIL_TO_PASS >= 2`: 14 (required >=4)

## v1 vs v2 selection delta

- Unchanged: 20
- Removed: none
- Added: none

## Leakage audit

- PASS
- Method: static provenance review of repository-local benchmark artifacts and the reused SWE-bench_Lite candidate pool.
- No Sol/Luna results, benchmark Advisor/Scout results, leaderboard/model results, generated patches, or historical control outcomes were consulted.

## Preflight

- Status: `MANIFEST PREFLIGHT FAILED`
- Ready: 4/20
- Canonical adapter preflight artifact: `benchmarks/swebench/artifacts/hard-baseline-v2/preflight.json`

| Task | Base | Test Patch | Initial | Gold | Reverted | Environment |
| --- | --- | --- | --- | --- | --- | --- |
| sympy__sympy-16792 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| sphinx-doc__sphinx-8474 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| django__django-11019 | PASS | PASS | FAIL | PASS | FAIL | COMPLETE |
| sphinx-doc__sphinx-7686 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| scikit-learn__scikit-learn-15535 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| matplotlib__matplotlib-25442 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| sympy__sympy-20639 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| sympy__sympy-20049 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| sphinx-doc__sphinx-10451 | FAIL | FAIL | FAIL | FAIL | FAIL | INCOMPLETE |
| scikit-learn__scikit-learn-25747 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| django__django-16820 | PASS | PASS | FAIL | PASS | FAIL | COMPLETE |
| sympy__sympy-21171 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| scikit-learn__scikit-learn-14092 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| matplotlib__matplotlib-23964 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| django__django-13265 | PASS | PASS | FAIL | PASS | FAIL | COMPLETE |
| matplotlib__matplotlib-18869 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| django__django-14997 | PASS | PASS | FAIL | PASS | FAIL | COMPLETE |
| matplotlib__matplotlib-22711 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| scikit-learn__scikit-learn-25638 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |
| sphinx-doc__sphinx-8713 | PASS | PASS | FAIL | FAIL | FAIL | COMPLETE |

Manifest SHA-256: `44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193`
