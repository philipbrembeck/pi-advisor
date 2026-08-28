# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Fixed

- Made blocked automatic-gate decisions honor the configured session, tool, or warning behavior.
- Allowed failed local Advisor outcome writes to be retried without consuming the advice.

## 0.4.0

### Added

- Exposed provider-reported Advisor and Scout token/cache/cost details per result, tracked cumulative direct Advisor usage in the session footer and optional summary, and attached normalized `ask_advisor` usage to Pi's built-in cost totals without double-counting manual consultations or automatic gates.

### Removed

- Removed the repository-only Benchmark suite and its benchmark-specific telemetry instrumentation.

### Fixed

- Kept Scout's serialized manifest limit separate from the Advisor conversation budget so required context does not fall back solely because of manifest metadata overhead.
- Made unlimited Advisor call budgets live at every enforcement boundary, preventing stale finite limits from triggering false Herdr budget notifications after switching to unlimited.

## 0.3.6

### Fixed

- Limited `/advisor-models` to models available through the user's configured Pi providers, preventing unavailable defaults from being displayed or selected and ensuring new selections are used immediately by `/advisor` in the same session.

## 0.3.5

### Changed

- Kept intentional local preference filename and Herdr method identifiers in separate components in published code so Socket's URL-string heuristic does not misclassify them.
- Made Scout recover from hallucinated group IDs by ignoring unknown selections and retaining required context instead of discarding the entire curation.
- Added visible footer progress and Advisor-stream forwarding for `/advisor-manual` consultations ([#10](https://github.com/philipbrembeck/pi-advisor/issues/10)).

## 0.3.4

### Changed

- Updated the development toolchain and Pi compatibility test matrix to the current supported patch releases.
- Added pull-request validation and made release tags wait for frozen-install, typecheck, test, lint, package, and security-audit checks.
- Kept Bun security auditing outside the publish workflow so an audit failure prevents a new tag instead of invalidating an existing release tag.
- Added a package allowlist check for the published tarball and retained npm provenance publishing.

### Security

- Confirmed the Socket URL-string findings for `advisor-preferences.md` and `notification.show` are intentional command/path identifiers, not network endpoints.
- Retained the constrained filesystem access required for explicit repository-file handoff; no new Socket issues were reported for 0.3.3.

## 0.3.3

### Added

- Added **EXPERIMENTAL** Advisor Scout, an opt-in conversation curator that uses the configured Executor model before every Advisor invocation. It keeps selected evidence verbatim, labels its synthesis as untrusted inference, reports separate usage and latency, and falls back to the original context without changing Advisor or gate safety behavior. The experiment adapts the context-boundary idea from the [FastContext paper](https://arxiv.org/html/2606.14066v1); it is not the paper's repository explorer and does not claim its reported effect size.

### Fixed

- Kept Scout history within the Advisor's remaining context budget, including zero-budget behavior, and kept pending Advisor drafts and attachment paths outside Scout's input.
- Included the current repeated tool invocation in automatic-gate Scout context.

## 0.3.2

### Release status

- Not published because the release validation workflow failed three tests before publication.

## 0.3.1

### Changed

- Updated the supported runtime baseline to Pi 0.84.1 and verified Herdr reporting against Herdr 0.8.0 while retaining the same request compatibility with Herdr 0.7.5.

### Fixed

- Show configured models and thinking levels first and ticked in `/advisor-models`, allowing Enter to keep each current selection.

## 0.3.0

### Added

- Added discretionary, sequential Advisor file handoff: when globally enabled, the Executor can attach explicitly named tracked working-tree files with `includeTrackedFiles` after the Advisor says it cannot review one. Tracked and untracked attachments remain separate consent paths and share bounded, redacted disclosure limits.

## 0.2.9

### Fixed

- Preserved custom numeric values when stepping `/advisor-settings` controls instead of resetting off-preset budgets and disclosure caps.
- Kept recorded session blocks enforced after `/advisor-off`, restored configuration after failed activation, and charged Advisor-call budgets only when consultation execution begins.
- Kept conversation and repository disclosure within their configured caps and explicitly identified disabled repository context as withheld.
- Made concurrent outcome records append safely with one exclusively initialized digest salt, and stopped superseded manual consultations from entering session summaries.
- Preserved and ignored forward-compatible `advisor.json` fields with a warning, and made malformed configuration errors actionable in every Advisor command.
- Isolated call budgets, repeated-action counters, and safety blocks between concurrent same-process sessions.
- Kept the repository-context withheld warning visible when its disclosure budget is zero.

## 0.2.8

### Fixed

- Advisor session blocks are reported to Herdr again. Herdr grants each pane a single lifecycle status authority, which for Pi is Herdr's own `herdr-agent-state` integration, and silently drops semantic state from any other source. The Advisor block now signals that integration over Pi's in-process event bus (`herdr:blocked`) instead of relying on display metadata alone, so a blocked pane shows `blocked` rather than `working`. Only the unblocked-to-blocked edge emits, because the listener refcounts; clears are always delivered.

## 0.2.7

### Security

- Escaped every untrusted Advisor prompt region and hardened automatic decision parsing against malformed fenced blocks ([#2](https://github.com/philipbrembeck/pi-advisor/issues/2)).
- Kept Advisor prompts, models, gates, budgets, disclosure, redaction, integrations, and consent global by no longer applying repository-controlled project `advisor.json` files ([#3](https://github.com/philipbrembeck/pi-advisor/issues/3)).
- Redacted unterminated oversized PEM blocks before bounded preference or untracked-file content can leave the process ([#4](https://github.com/philipbrembeck/pi-advisor/issues/4)).
- Bounded and redacted Herdr blocked-state metadata while reliably clearing previously reported labels ([#5](https://github.com/philipbrembeck/pi-advisor/issues/5)).
- Bounded untracked-file Git probes and switched to NUL-delimited path handling for non-ASCII filenames ([#6](https://github.com/philipbrembeck/pi-advisor/issues/6)).

### Changed

- Advisor settings now load and save globally. Move any intended values from project `.pi/advisor.json` files into the Pi agent directory's global `advisor.json`.
- Pi's bundled modules (`@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox`) are declared as optional peer dependencies. Installing the extension no longer installs a copy of them; Pi supplies them at runtime. Version ranges continue to document the supported Pi API.
- Published packages now include `CHANGELOG.md`.
- Release workflows pin GitHub Actions to commit SHAs, kept current by Dependabot.

## 0.2.6

### Added

- Draft-aware `ask_advisor` reviews with opaque advice IDs, explicit outcome reporting, trusted-project preferences, and opt-in explicit untracked-file context.
- Global-only, privacy-minimal outcome JSONL logging with salted advice digests and no raw advice, prompts, paths, repository data, or session identifiers.
- `.pi/advisor-preferences.md` support for trusted projects; preferences remain untrusted, redacted, capped, and never auto-written.

## 0.2.5

This version was never published to npm; its changes shipped in 0.2.6.

### Added

- Repository change context for consultations, controlled by `advisorGitContext` (`off`, `summary`, `full`, default `summary`) and capped by `advisorGitContextMaxChars`. `summary` discloses changed file names, change status, and line counts; `full` adds the patch. Untracked files are always reported by name only.
- An optional `gitContext` argument on `ask_advisor` so the Executor can request less, or request more up to the configured allowance. A request above the allowance is narrowed to it and the Advisor is told that a fuller view was withheld.
- Repository context is escaped and capped as a single labelled untrusted region, so a crafted path cannot end the region early and have following text read as instructions.

### Fixed

- Restored keyboard selection for the Context window slider in advanced `/advisor-settings` mode, matching its position at the top of the screen.

## 0.2.4

### Added

- Simple mode for voluntary `ask_advisor` and `/advisor-manual` consultations without automatic gates, blocks, budgets, or session summaries; privacy and context controls remain active.
- Persistent `alwaysOn` Advisor-flow activation, including Executor restoration and, while the flow is active, adoption of an explicit `/model` selection as the Executor. `/advisor-off` also turns persistent activation off.
- Simple-mode settings for voluntary Advisor use and persistent activation.
- Static `◆ ADVISOR · SOUND` rendering for ordinary Advisor replies beginning with `Verdict: sound`, for both `ask_advisor` results and `/advisor-manual` responses.

### Changed

- Session Advisor Summary now defaults to off.

### Fixed

- `/advisor contextMaxChars=N` now persists, so the supplied limit applies to later consultations instead of reverting at the next tool call.
- A zero context limit with no targeted focus no longer sends an empty Advisor request that some providers reject.
- An Advisor gate response that quotes a decision line inside a fenced example is no longer rejected as a duplicate or contradictory decision.
- Reconstructed Advisor context is assembled without re-joining the accumulated branch on every entry, which removes a slowdown on long sessions with large context limits.

## 0.2.3

### Added

- Optional local secret redaction for reconstructed Advisor context, including user messages, assistant text and tool arguments, compaction summaries, and full tool results.
- Exact-name Advisor tool disclosure policies: `full` includes call arguments and capped output; `summary` retains only result status and size metadata; `exclude` omits call details and output. Tools without a policy remain `full` for compatibility.
- `/advisor-settings` controls for secret redaction and inline JSON editing of tool disclosure policies, with validation errors that keep invalid input open for correction.
- Configuration validation, loading, and persistence for `advisorRedactSecrets` and `advisorToolPolicies`.

### Changed

- Redact eligible tool output before applying line and byte limits so truncated context cannot retain the beginning or end of a matched secret.
- Reorganize the README around installation, first use, commands, automatic gate behavior, configuration, privacy boundaries, development, and releases.

## 0.2.2

### Fixed

- Reopening `/advisor-settings` now displays values saved earlier in the same Pi session without requiring `/reload`.

## 0.2.1

### Added

- Ultracite lint commands and a Husky pre-commit hook that formats and lints staged TypeScript and JSON files.

### Changed

- Resolved the existing Ultracite lint violations through structural refactors and stronger type boundaries without changing Advisor-flow behavior.

### Fixed

- Empty persisted Executor, Advisor, and reasoning-effort settings now retain their configured defaults.
- Keep a session blocked after a critical automatic-gate decision or session-blocking gate failure.
- Preserve custom Advisor context and reasoning settings when saving unrelated changes.
- Persist an unlimited Advisor-call budget correctly after removing a prior finite limit.
- Enforce configured Advisor tool-result byte and line limits, including for long Unicode lines.
- Render automatic and manual Advisor failures in the transcript.
- Avoid false loop detection for semantic field names such as `update`.
- Make release automation skip unchanged versions while explicitly dispatching publication after an Action-created tag.

## 0.2.0

### Added

- Separate Markdown consultations from strict automatic loop-gate decisions.
- Typed gate parsing for `proceed`, `revise`, and `blocked`, including safe failure classification.

### Changed

- Normal Advisor and Executor-requested consultations preserve raw Markdown and no longer fabricate or enforce a structured verdict.
- Automatic gate decisions render separately from their Markdown explanation.
- Advisor calls now use one shared per-session budget with explicit used/remaining accounting.
- Gate failures support `block-session`, `block-tool`, and `warn-and-continue`; Herdr failures also show sanitized `notification.show` toasts when integration is enabled.
- Advisor settings validate values at startup, preserve unknown fields on save, and expose Herdr integration plus tool-result limits.
- Advisor context keeps complete semantic entries and caps oversized tool results using Pi-compatible defaults while preserving head/tail sections.
- Tool-result limits are configurable by line and byte count, with explicit omission markers that never split semantic entries.
- Loop detection now uses explainable normalized tool signatures with allowlisted volatile-field and shell-whitespace normalization.
- Local ephemeral summaries distinguish Markdown advice from automatic gate decisions and include triggers, models, usage/cost when available, budget, failures, and execution effects.

## [0.1.9]

### Fixed

- Keep manual and automatic Advisor responses human-readable. Manual consultations return direct Markdown; automatic loop reviews use a concise Markdown `Decision:` line for machine-readable gating without exposing a JSON protocol.

## [0.1.8]

### Added

- Structured Advisor verdicts: `proceed`, `revise`, `insufficient-evidence`, and critical `blocked` responses, with findings, required verification, and a smallest next step.
- Critical-block handling: optionally abort the active run, mark the session blocked, and report the blocked state to Herdr.
- Automatic loop gate that consults the Advisor after three equivalent tool calls. A `proceed` verdict resumes execution; `revise` and `insufficient-evidence` block only the repeated action; critical verdicts, failed reviews, and exhausted budgets block the session and report Herdr state.
- Per-session Advisor-call limit, with an Executor prompt hint only when a finite limit is configured.
- Local, in-memory-only `[Session Advisor Summary]` after a non-blocked settled run; no summary data is persisted or sent to Herdr.
- `/advisor-settings` controls for critical blocking, enabling/disabling the automatic loop gate, loop threshold, max Advisor calls per session, and the Session Advisor Summary.
- Session-state tests covering loop detection, Advisor-call budgets, and summary generation.
- Research note covering evidence-backed Advisor-flow improvements.

### Changed

- Advisor responses now require validated JSON and safely fall back to `insufficient-evidence` when the response is malformed.
- Manual, Executor-requested, and automatic Advisor consultations share the configured session call limit.
- Herdr activity and blocked state use separate extension metadata sources so clearing one does not clear the other.


## [0.1.7]

### Added

- Herdr integration: Advisor consultations display as `seeking advice` while active when Pi runs in a Herdr-managed pane.

## [0.1.6]

### Added

- `/advisor-manual [focus]` to start an Advisor consultation in parallel without interrupting the Executor's active tool work; the completed advice is delivered before the Executor's next model call.
- Immediate transcript entries and rendered Advisor responses for manual consultations.

### Changed

- Reuse the Advisor call UI for manual consultations and cancel an earlier manual request when a newer one starts or the session shuts down.

## [0.1.5]

### Added

- `/advisor-settings`: one keyboard-navigable screen for Advisor context size, reasoning effort, invocation gates, response collapsing, and a custom invocation rule.
- Claude Code-style Advisor context selector with `0`, `10k`, `25k`, `100k`, `200k`, and `ALL` presets.
- Individually configurable plan, repeated-failure, and completion-review Advisor gates.
- Optional collapsed Advisor responses that expand with `Ctrl+O`.
- Inline custom invocation-rule editing in Advisor settings.

### Changed

- General `ask_advisor({})` consultations now send conversation context without an invented request or question; targeted questions remain optional.
- Advisor instructions explicitly tell the Executor not to invent a question for a normal review and tell the Advisor to make a best-effort contextual review without requesting more input.
- Preserve unknown fields when saving `advisor.json`.
- Support `0` as a no-history context setting and `Number.MAX_SAFE_INTEGER` as the ALL-context sentinel.

### Fixed

- Ignore persisted Advisor configuration files with invalid field types instead of crashing during model resolution.
- Restore interactive Advisor settings arrow-key navigation using Pi TUI key matching.

## [0.1.4]

### Added

- Configurable reconstructed-conversation limit via `contextMaxChars` in `advisor.json` or `/advisor contextMaxChars=N` (default: 15,000; maximum: 1,000,000).

### Changed

- Clarified that the Executor may call `ask_advisor({})` without a question for a general review.
- Removed the extra no-question “General task review” text from the Advisor call UI.
- Reframed Advisor guidance as a brief second opinion that stress-tests the Executor's own candidate direction rather than taking over planning.

## [0.1.3]

### Documentation

- Changed publication flow, no code changes

## [0.1.2]

### Added

- General contextual Advisor reviews: the Executor can call `ask_advisor({})` without a specific question.
- A skill-style Advisor invocation row that distinguishes an Executor request from an Advisor response.
- Markdown rendering support for the Advisor response, including code blocks and inline code.

### Changed

- Advisor responses display the advising model and advice separately from the tool-result payload.
- The Advisor spinner is shown only while a response is streaming and is cleared when the response completes.

## [0.1.1]

### Documentation

- Fixed documentation link

## [0.1.0]

### Added

- Initial npm and git package release.
