# SWE-bench Hard Baseline v2 Manifest Integrity Audit

## Original identity

- Expected legacy SHA: `44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193`
- Original raw-file SHA: `e6d7f25bd887e8bd59fa1cb76ce768e4da38299687899671ce4e1bd2ccec3e5b`
- Original canonical JSON SHA: `44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193`
- Hash algorithm: SHA-256 over the recursive `stableJson` serializer in `hard-baseline-v2-builder.ts`.
- Original artifact: `benchmarks/swebench/artifacts/hard-baseline-v2/manifest-original-frozen.json`

## Current identity

- Current raw-file SHA: `e6d7f25bd887e8bd59fa1cb76ce768e4da38299687899671ce4e1bd2ccec3e5b`
- Current canonical JSON SHA: `44872ee3bfef9ad87bf1b9c3449658f9635ff086c328ca18febdb74ae4abe193`
- Current artifact: `benchmarks/swebench/artifacts/hard-baseline-v2/manifest-current.json`

The observed raw SHA differs from the recorded legacy SHA because the recorded identity is canonical JSON, not file bytes. The canonical SHA reproduces the expected value exactly.

## Semantic diff

- Recursive diff between preserved original/current copies: none.
- No preflight, adapter, environment, timestamp, or absolute-path fields are present in the immutable manifest object. Runtime/preflight metadata is stored in separate artifacts.

## Critical-field comparison

| # | Task | Base | Test patch | Gold patch | F2P/P2P | Source definition | Criterion |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | sympy__sympy-16792 | `09786a173e7a` | `f24cf4c18ab0` | `05dba3a192d2` | 1/54 | yes | production-file coverage |
| 2 | sphinx-doc__sphinx-8474 | `3ea1ec84cc61` | `5e60d855d53c` | `51bb8522a82b` | 4/436 | yes | FAIL_TO_PASS coverage |
| 3 | django__django-11019 | `93e892bb645b` | `a5a9d15643ca` | `250e6b379075` | 16/58 | yes | production-file coverage |
| 4 | sphinx-doc__sphinx-7686 | `752d3285d250` | `e0556f4d52be` | `0c9eefddd594` | 2/15 | yes | intrinsic complexity heuristic v2 |
| 5 | scikit-learn__scikit-learn-15535 | `70b0ddea992c` | `649ba6053a4d` | `4fd2c2b34fef` | 8/52 | yes | FAIL_TO_PASS coverage |
| 6 | matplotlib__matplotlib-25442 | `73394f2b1132` | `d17a431110f5` | `d56dc3aa2c82` | 1/275 | yes | production-file coverage |
| 7 | sympy__sympy-20639 | `eb926a1d0c11` | `142a286ca890` | `0de7671d3340` | 2/139 | yes | intrinsic complexity heuristic v2 |
| 8 | sympy__sympy-20049 | `d57aaf064041` | `a73fe5422b71` | `94bf2770a961` | 4/9 | yes | FAIL_TO_PASS coverage |
| 9 | sphinx-doc__sphinx-10451 | `195e911f1dab` | `23b1aa0d1dac` | `a36d44cd50db` | 2/80 | yes | production-file coverage |
| 10 | scikit-learn__scikit-learn-25747 | `2c867b8f822e` | `cac30ce018b3` | `dbb641d3c9b3` | 1/14 | yes | problem-statement-length coverage |
| 11 | django__django-16820 | `c61219a7ae05` | `c2e1d356d35b` | `f2ef1fcad14a` | 7/203 | yes | FAIL_TO_PASS coverage |
| 12 | sympy__sympy-21171 | `aa22709cb7df` | `0ea6970927c1` | `11fcabc72a94` | 1/152 | yes | problem-statement-length coverage |
| 13 | scikit-learn__scikit-learn-14092 | `df7dd8391148` | `f6f9e21d1359` | `cd1b46e39b48` | 3/212 | yes | production-file coverage |
| 14 | matplotlib__matplotlib-23964 | `269c0b94b4fc` | `774274ddd359` | `9dbc9132cad9` | 1/16 | yes | problem-statement-length coverage |
| 15 | django__django-13265 | `b2b0711b555f` | `aa941f9623fd` | `8dc162aac1aa` | 4/119 | yes | intrinsic complexity heuristic v2 |
| 16 | matplotlib__matplotlib-18869 | `b7d05919865f` | `de67a807f5f0` | `eb68c14f4f4a` | 4/3 | yes | FAIL_TO_PASS coverage |
| 17 | django__django-14997 | `0d4e575c96d4` | `f66e4062ff5b` | `6737fad31b7b` | 3/144 | yes | problem-statement-length coverage |
| 18 | matplotlib__matplotlib-22711 | `f670fe78795b` | `b29c7b5ab1a0` | `08cb3a61ee4a` | 2/91 | yes | intrinsic complexity heuristic v2 |
| 19 | scikit-learn__scikit-learn-25638 | `6adb209acd63` | `ffd8dcee777e` | `f1838c78a0d3` | 10/194 | yes | intrinsic complexity heuristic v2 |
| 20 | sphinx-doc__sphinx-8713 | `3ed7590ed411` | `e73f9c7126ff` | `c0b41846ee8d` | 1/45 | yes | problem-statement-length coverage |

## Intrinsic metrics and provenance

- The current manifest does not contain intrinsic metrics; those are preserved in the candidate-pool-view and selection-provenance artifacts.
- Candidate-pool canonical identity: `6282101e12dd1d79667de8f04e45554971d329c9be058b864186fb7394eb9dbb` (expected `6282101e12dd1d79667de8f04e45554971d329c9be058b864186fb7394eb9dbb`).
- Candidate-pool unchanged: yes.
- Selection order/provenance IDs: identical.

## Identity design fix

- Added `benchmarks/swebench/manifest-identity.ts` with the exact legacy canonical serializer and an explicit semantic projection.
- Added `benchmarks/swebench/hard-baseline-v2-selection-manifest.json`, separating immutable selection identity from execution/preflight artifacts.
- Added regression tests for formatting, mutable metadata, order, task identity, commits, patch hashes, F2P/P2P, criterion, and selection metrics.

## Resume decision

- Semantic manifest SHA: `f47a191590b8a39880a6770023035e812e8cae886b94a0f16e34e7c59dcbd588`
- Semantic identity original/current equal: yes
- Task membership identical: yes
- Task order identical: yes
- Canonical task definitions identical: yes
- Selection provenance identical: yes
- Candidate pool unchanged: yes
- Inference run: NO
- Clean post-verification preflight artifact: `benchmarks/swebench/artifacts/hard-baseline-v2/preflight-after-identity.json`
- Clean post-verification readiness: 9/20

**MANIFEST SEMANTIC IDENTITY VERIFIED — CONTINUE PREFLIGHT**
