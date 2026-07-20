# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
