# [pi-advisor](https://github.com/philipbrembeck/pi-advisor)

<div align="center">

![Pi Advisor consultation in the terminal](https://raw.githubusercontent.com/philipbrembeck/pi-advisor/refs/heads/main/assets/screenshot.png)

A configurable second-opinion workflow for <a href="https://github.com/earendil-works/pi">Pi</a> coding agents, inspired by the ["Steering Black-Box LLMs with Advisor Models" paper](https://arxiv.org/abs/2510.02453) and Claude's [Advisor](https://code.claude.com/docs/en/advisor) feature.

</div>

![Downloads](https://img.shields.io/npm/d18m/pi-advisor-flow?style=flat) ![NPM Version](https://img.shields.io/npm/v/pi-advisor-flow?style=flat) ![Pi Advisor Flow badge](https://img.shields.io/badge/advisor%20flow-fff?logo=pi&logoColor=000)

`pi-advisor-flow` keeps one model focused on execution and makes a second, smarter model available for consequential decisions, stalled work, and final reviews. The Executor still owns the work. The Advisor challenges assumptions, exposes risks, and suggests verification steps without taking over or running tools.

Keep implementation on a fast model and borrow frontier reasoning only when decisions matter. [Read why this workflow is useful](https://philipbrembeck.com/writings/2026/07/only-as-much-intelligence-as-you-need).

## Features

- **On-demand second opinions** through the `ask_advisor` tool or `/advisor-manual`.
- **Configurable review gates** before plans, after repeated failures, and before declaring completion.
- **Automatic loop detection** for repeated tool calls, with explicit proceed, revise, or blocked decisions.
- **Separate model and reasoning controls** for the Executor and Advisor.
- **Advisor usage accounting** with per-response token and cost details, normalized usage in Pi's `/cost` totals, and an optional cumulative footer.
- **Privacy controls** for conversation history, repository context, explicit file handoff, tool results, secret redaction, and outcome logging.
- **Optional persistent activation, Simple mode, session summaries, and Herdr integration.**
- **Compact searchable `/advisor-settings`** that matches Pi's settings list and saves changes immediately.
- **Experimental Advisor Scout** that uses the configured Executor model to curate conversation evidence before every Advisor call.

## How it works

1. The Executor investigates the task and forms its own candidate direction.
2. For a consequential decision, stalled attempt, or final review, it calls `ask_advisor` or an enabled gate starts a review.
3. pi-advisor reconstructs the relevant conversation and allowed repository context.
4. The Advisor returns an opinion with risks, alternatives, and verification steps.
5. The Executor decides what to adopt, changes the code, and validates it.

Regular consultations never block execution. Automatic loop gates are different: they evaluate repeated tool calls and can stop a tool action or session based on your configured failure policy.

## Install

Requires Pi 0.84.1 or later. Pi 0.85.0 is not supported (broken upstream release); use Pi 0.85.1 or later instead.

```bash
pi install npm:pi-advisor-flow
```

You can also install from GitHub:

```bash
pi install git:github.com/philipbrembeck/pi-advisor.git
```

Reload Pi after installing.

## Quick start

```text
/advisor            # Enable the Advisor Flow
/advisor-models     # Choose the Executor and Advisor models
/advisor-settings   # Configure behavior, modes, etc.
```

On first use, or whenever a saved model is unavailable, `/advisor` opens the same available-model picker as `/advisor-models`; it never silently chooses an unconfigured model. You can also enable the flow and select both models at once:

```text
/advisor executor=openai-codex/gpt-5.6-luna advisor=openai-codex/gpt-5.6-sol
```

From the Executor, `ask_advisor({})` requests a general review. A targeted `question` or concise `draft` can focus the review on a particular decision.

In the Settings, enable Simple Mode for a quick start.

![Pi Advisor Settings Panel](https://raw.githubusercontent.com/philipbrembeck/pi-advisor/refs/heads/main/assets/settings.png)

Unknown fields in `advisor.json` are preserved for forward compatibility and reported as non-blocking warnings. Invalid recognized values fail their own Advisor call with a clear message instead of blocking every tool call.

## Usage and accounting

Advisor responses show provider-reported input, output, cache, and cost details when available. Successful `ask_advisor` calls also carry normalized usage into Pi's built-in `/cost` totals. Manual consultations and automatic gates keep their own session-local accounting instead, so nothing is double-counted. Missing or partial provider usage is shown as unavailable rather than fabricated as zero. `/advisor-settings` controls both the per-response details and the optional cumulative footer independently.

Successful calls return an opaque `adviceId`. If global outcome logging is enabled, the Executor can call `record_advisor_outcome` once to record whether the advice was adopted and whether final validation passed.

## Commands

| Command                   | What it does                                        |
| ------------------------- | --------------------------------------------------- |
| `/advisor`                | Enable the flow; choose available models when needed. |
| `/advisor-manual [focus]` | Ask for an immediate second opinion.                |
| `/advisor-models`         | Choose the Executor and Advisor models.             |
| `/advisor-settings`       | Configure behavior, context, privacy, and limits.   |
| `/advisor-off`            | Disable the flow and persistent activation.         |

In the interactive TUI, `/advisor-manual [focus]` opens a centered overlay with the focus text prefilled, a choice of permitted Git-context level, and live progress in the transcript. Canceling has no side effects.

### Experimental Advisor Scout

Advisor Scout is off by default. When enabled in `/advisor-settings` or via `"advisorScoutEnabled": true`, the Executor model first selects relevant conversation history before the Advisor sees it. Scout runs in a separate model call, which adds cost and latency up front but can shrink the Advisor call. A bounded result shows the model, selection counts, and usage; on any failure it falls back to sending the original conversation unchanged. This experiment adapts the context-boundary idea from Zhang et al., ["FastContext: Training Efficient Repository Explorer for Coding Agents"](https://arxiv.org/html/2606.14066v1) — it curates conversation history only and is not a reproduction of FastContext. See the [configuration guide](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/configuration.md) for details.

## Privacy

Advisor requests can include user messages, tool calls, tool results, targeted questions, and repository information. Repository context is configurable from no access through changed-file summaries to a capped patch; when it is disabled, the Advisor is told so rather than shown an apparently clean tree. Explicit tracked and untracked file contents require separate global opt-ins and are sent as untrusted data. Secret redaction is off by default; when enabled, credential-shaped values in targeted questions are redacted before the provider request. Tools without an explicit policy use full context. Settings are global, so a project cannot silently change them.

When Scout is enabled, the Executor model provider also receives bounded Advisor-eligible conversation history. Read [Privacy and data handling](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/privacy.md) before using pi-advisor with sensitive work.

## Documentation

- [Configuration and automatic loop gates](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/configuration.md)
- [Privacy and data handling](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/privacy.md)
- [Development](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/development.md)
- [Benchmarking](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/benchmark.md)
- [Documentation index](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/README.md)

## Links

- [Changelog](CHANGELOG.md)
- [MIT License](LICENSE)
- [npm package](https://www.npmjs.com/package/pi-advisor-flow)
- [Why use an Advisor flow?](https://philipbrembeck.com/writings/2026/07/only-as-much-intelligence-as-you-need)
