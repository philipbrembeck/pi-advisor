# Benchmark implementation status

State values: `not-started`, `in-progress`, `done`.

| Phase | State | Current blocker / exit note |
| --- | --- | --- |
| 0 — scaffolding, controls, Harbor spike | done | Harbor oracle canary passes 1/1; an allowlisted Pi probe reaches the provider endpoint and receives a deliberate 401. Authenticated model execution remains a Phase 4 blocker. |
| 1 — Tier 1 replay | done | Offline replay passes 18 gate cases, zero privacy leaks, pin assertions, context, budget, and determinism checks; CI runs `bench:replay`. |
| 2 — Tier 2 bootstrap corpus | done | 24 derived items (12 positive/12 negative) load successfully; provenance and scorer-key privacy are checked in replay and tests. |
| 3 — Q1 scoring and nightly run | in-progress | Offline 24-item scoring, controls, budget checks, reports, and nightly workflow are ready; live provider pricing/credentials are unavailable, so Scout numbers and the live <$10 report remain unmeasured. |
| 4 — Pi/Harbor adapter and Stage 1 screening | in-progress | The checked-in executable Harbor wrapper, Harbor 0.18-compatible Pi agent, conservative per-trial budget proxy, artifact validation, and protocol tests are complete; an authenticated real Harbor/Pi trial and Stage 1 screening are still required. |
| 5 — Stage 2 evaluation | not-started | Requires Phase 4 screening output and preregistration. |
| 6 — reseed Tier 2 from trajectories | not-started | Requires archived Stage 2 trajectories. |

## Resume protocol

Read this file, then verify the artifact paths and commands for the first phase that is not `done`. Never run screening or evaluation before the corresponding section of `PREREGISTRATION.md` is committed. Live commands require `BENCH_LIVE=1` and must never run from pull-request CI.
