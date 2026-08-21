# SWE-bench Control v2

Fresh results: `/Users/philipbrembeck/.pi/agent/extensions/pi-advisor/benchmarks/swebench/results/exp-20260818-swebench-control-v2.jsonl`

The adapter prepares the exact base commit and canonical test patch before model invocation. Validation replays only production changes on a canonical prepared worktree, so model edits to benchmark-test files cannot alter the validator.

## Scorability

| Mode | Total | Scorable | Unscorable |
| --- | ---: | ---: | ---: |
| Sol | 15 | 15 | 0 |
| Luna | 15 | 15 | 0 |

## Correctness

| Mode | Success | Scorable | Rate |
| --- | ---: | ---: | ---: |
| Sol | 15 | 15 | 100.0% |
| Luna | 15 | 15 | 100.0% |

## Paired outcomes

- both pass: 15
- Sol-only pass: 0
- Luna-only pass: 0
- both fail: 0
- unscorable pair: 0

## Per-task results

| Task | Sol | Luna |
| --- | ---: | ---: |
| django__django-15819 | 3/3 | 3/3 |
| django__django-15902 | 3/3 | 3/3 |
| django__django-15996 | 3/3 | 3/3 |
| django__django-16041 | 3/3 | 3/3 |
| django__django-16046 | 3/3 | 3/3 |

## Failure reasons

None.

## Infrastructure failures

None.

## Cost / latency

| Mode | Mean cost / attempt | Median duration | P90 duration | Model calls | Agent turns | Tool calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sol | N/A | 75.74s | 114.49s | 197 | 197 | 327 |
| luna | N/A | 60.25s | 107.34s | 235 | 235 | 309 |

## Historical differential cases

- sol: 15996 3/3, 15902 3/3, 16046 3/3; no control-test-patch-apply outcomes.
- luna: 15996 3/3, 15902 3/3, 16046 3/3; no control-test-patch-apply outcomes.

## Adapter invariants

- Setup failures are classified before model invocation.
- Model patches are captured relative to the benchmark-prepared state.
- Canonical test files are restored by validation worktrees and are never used from the model's mutated workspace.
- Declared temperature is recorded separately from effective provider fields; absent transmission is reported as provider-controlled.
- Advisor modes were not run.
- Archived v2 execution IDs are deterministic hashes of the frozen task/model/repetition entry; the current adapter persists its random execution ID directly.
