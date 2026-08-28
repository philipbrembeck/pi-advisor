# pi-advisor

<div align="center">

![Pi Advisor consultation in the terminal](https://raw.githubusercontent.com/philipbrembeck/pi-advisor/refs/heads/main/assets/screenshot.png)

A configurable second-opinion workflow for <a href="https://github.com/earendil-works/pi">Pi</a> coding agents, inspired by the ["Steering Black-Box LLMs with Advisor Models" paper](https://arxiv.org/abs/2510.02453) and Claude's [Advisor](https://code.claude.com/docs/en/advisor) feature.

</div>


![d18m Downloads](https://img.shields.io/npm/d18m/pi-advisor-flow?style=flat) ![NPM Version](https://img.shields.io/npm/v/pi-advisor-flow?style=flat)

`pi-advisor-flow` keeps one model focused on execution and makes a second, smarter model available for consequential decisions, stalled work, and final reviews. The Executor still owns the work. The Advisor challenges assumptions, exposes risks, and suggests verification steps without taking over or running tools.

The idea is simple: keep implementation on a fast model and borrow frontier reasoning only when decisions matter. [Read why this workflow is useful](https://philipbrembeck.com/writings/2026/07/only-as-much-intelligence-as-you-need).

## Features

- **On-demand second opinions** through the `ask_advisor` tool or `/advisor-manual`.
- **Configurable review gates** before plans, after repeated failures, and before declaring completion.
- **Automatic loop detection** for repeated tool calls, with explicit proceed, revise, or blocked decisions.
- **Separate model and reasoning controls** for the Executor and Advisor.
- **Advisor usage accounting** with per-response token/cost details and cumulative direct usage in the Pi footer and session summary.
- **Privacy controls** for conversation history, repository context, explicit tracked/untracked file handoff, tool results, secret redaction, and outcome logging.
- **Optional persistent activation, Simple mode, session summaries, and Herdr integration.**
- **EXPERIMENTAL Advisor Scout** that uses the configured Executor model to curate conversation evidence before every Advisor call.

## Install

Requires Pi 0.84.1 or later and is compatible with Herdr 0.8.0.

```bash
# npm
pi install npm:pi-advisor-flow

# GitHub
pi install git:github.com/philipbrembeck/pi-advisor.git

# local checkout
pi install /path/to/pi-advisor
```

Restart or reload Pi after installation.

## Quick start

1. Run `/advisor` to enable the flow and register `ask_advisor`.
2. Run `/advisor-models` to choose the Executor and Advisor models. Current model and thinking-level selections appear first and ticked, so pressing Enter keeps them.
3. Run `/advisor-settings` to configure review gates, context, privacy, and limits.

![Advisor Settings](https://raw.githubusercontent.com/philipbrembeck/pi-advisor/refs/heads/main/assets/settings.png)

Unknown fields in `advisor.json` are preserved for forward compatibility and reported as non-blocking warnings. Invalid recognized values remain errors, and Advisor commands show the configuration problem without crashing their handlers.

You can also enable the flow and select both models at once:

```text
/advisor executor=openai-codex/gpt-5.6-luna advisor=openai-codex/gpt-5.6-sol
```

## How it works

1. The Executor investigates the task and forms its own candidate direction.
2. For a consequential decision, stalled attempt, or final review, it calls `ask_advisor` with the reconstructed conversation and allowed repository context.
3. When Experimental Advisor Scout is enabled, the configured Executor model selects relevant conversation groups and writes a short, explicitly untrusted synthesis.
4. The Advisor receives selected verbatim evidence, required current-request context, and the unchanged deterministic repository, preference, draft, and attachment regions.
5. The Executor decides what to adopt, performs the work, and validates the result.

A normal consultation never blocks execution. The optional automatic loop gate is different: it evaluates repeated tool calls and applies the configured failure policy when the Advisor says to revise, reports a block, is unavailable, or returns an invalid decision.

Advisor responses show provider-reported input, output, cache, and cost details when available. Successful `ask_advisor` tool results also carry normalized usage into Pi's built-in `Tools/summaries` and `/cost` totals. Manual consultations and automatic gates remain in the separate session-local direct Advisor accounting because they are custom messages, so they are not double-counted in Pi's Executor totals. Missing or partial provider usage is shown as unavailable rather than fabricated as zero usage.

Successful calls return an opaque `adviceId`. If global outcome logging is enabled, the Executor can call `record_advisor_outcome` once to record whether the advice was adopted and whether final validation passed.

### Experimental Advisor Scout

Experimental Advisor Scout is off by default. Enable `Experimental Advisor Scout` in the advanced `/advisor-settings` screen or set `"advisorScoutEnabled": true` in the global `advisor.json`.

Scout runs before `ask_advisor`, `/advisor-manual`, and automatic Advisor gates. It uses the configured Executor model and Executor reasoning effort in a separate model call. This adds cost and latency, but can reduce cost in the Advisor call. The compact result shows the model, selection counts, and elapsed time; `Ctrl+O` shows bounded selected labels and the synthesis.

Scout receives a bounded manifest of conversation and tool-history groups after the normal tool disclosure, result-cap, and redaction policies are applied. The Scout manifest has its own fixed transport limit, while the reconstructed conversation remains bounded by the Advisor's remaining context budget after repository context; manifest metadata no longer consumes that Advisor conversation budget. A zero remaining budget produces no history groups. For a pending `ask_advisor` call, Scout receives only the allowlisted question and Git-context preference, never the draft or explicit attachment paths. Scout does not receive the deterministic Git context, draft, project preferences, or explicit tracked and untracked attachments. Those regions are appended later through their existing consent and cap rules.

This experiment adapts the context-boundary idea from Zhang et al., ["FastContext: Training Efficient Repository Explorer for Coding Agents"](https://arxiv.org/html/2606.14066v1). It is not a reproduction of FastContext. pi-advisor Scout curates conversation history only.

## Commands

| Command | Purpose |
| --- | --- |
| `/advisor` | Enable the flow and optionally override the Executor, Advisor, or context limit. |
| `/advisor-manual [focus]` | Start a parallel consultation without interrupting the current Executor turn; shows progress in the footer. |
| `/advisor-models` | Choose both models and their reasoning effort; current models are preselected. |
| `/advisor-settings` | Configure behavior, context, gates, privacy, and output limits. |
| `/advisor-off` | Disable the flow and turn off persistent activation. |

The Executor calls `ask_advisor({})` for a general review. It can pass a targeted `question` or a concise `draft` describing proposed work, validation, and remaining risks. If the Advisor explicitly says it cannot review a specifically named file, the Executor may make a sequential follow-up call with `includeTrackedFiles` when global consent is enabled and the file is relevant. Draft claims give the Advisor review context; they are not verification evidence.

## What gets sent to the Advisor

Advisor context can include user messages, tool calls, tool results, and repository information. Secret redaction is off by default, and tools without an explicit disclosure policy default to full context. Review the privacy settings before using the extension with sensitive work.

When Experimental Advisor Scout is enabled, the Executor model provider also receives bounded Advisor-eligible conversation history. Scout does not receive the deterministic repository, draft, preference, or explicit-file regions described below.

Repository context is configurable from no access through changed-file summaries to a capped patch. When context is disabled or its budget is zero, the Advisor is told it was withheld rather than shown an apparently clean tree. Explicit tracked and untracked file contents require separate global opt-ins; attachments are capped, redacted when configured, and sent as untrusted data.

## Documentation

- [Configuration and automatic loop gates](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/configuration.md)
- [Privacy and data handling](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/privacy.md)
- [Development](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/development.md)
- [Documentation index](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/README.md)

## Links

- [MIT License](LICENSE)
- [Changelog](CHANGELOG.md)
- [npm package](https://www.npmjs.com/package/pi-advisor-flow)
- [Why use an Advisor flow?](https://philipbrembeck.com/writings/2026/07/only-as-much-intelligence-as-you-need)
