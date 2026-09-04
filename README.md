# [pi-advisor](https://github.com/philipbrembeck/pi-advisor)

<div align="center">

![Pi Advisor consultation in the terminal](https://raw.githubusercontent.com/philipbrembeck/pi-advisor/refs/heads/main/assets/screenshot.png)

A configurable second-opinion workflow for <a href="https://github.com/earendil-works/pi">Pi</a> coding agents, inspired by the ["Steering Black-Box LLMs with Advisor Models" paper](https://arxiv.org/abs/2510.02453) and Claude's [Advisor](https://code.claude.com/docs/en/advisor) feature.

</div>

![d18m Downloads](https://img.shields.io/npm/d18m/pi-advisor-flow?style=flat) ![NPM Version](https://img.shields.io/npm/v/pi-advisor-flow?style=flat)

`pi-advisor-flow` keeps one model focused on execution and makes a second, smarter model available for consequential decisions, stalled work, and final reviews. The Executor still owns the work. The Advisor challenges assumptions, exposes risks, and suggests verification steps without taking over or running tools.

Keep implementation on a fast model and borrow frontier reasoning only when decisions matter. [Read why this workflow is useful](https://philipbrembeck.com/writings/2026/07/only-as-much-intelligence-as-you-need).

## How it works

1. The Executor works on your task as usual.
2. It calls `ask_advisor`, or an enabled gate starts a review.
3. pi-advisor reconstructs the relevant conversation and allowed repository context.
4. The Advisor returns an opinion. The Executor decides what to adopt, changes the code, and validates it.

Regular consultations do not block execution. Automatic loop gates are different: they can stop a repeated tool action or session based on your configured failure policy.

## Install

Requires Pi 0.84.1 or later.

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

On first use, or whenever a saved model is unavailable, `/advisor` opens the same available-model picker as `/advisor-models`; it never silently chooses an unconfigured model. After activation, `/advisor` explains that the Advisor reviews the Executor's context without changing files or running tools.

From the Executor, `ask_advisor({})` requests a general review. A targeted `question` or concise `draft` can focus the review on a particular decision.

In the Settings, enable the Simple Mode for a quick start.
![Pi Advisor Settings Panel](https://raw.githubusercontent.com/philipbrembeck/pi-advisor/refs/heads/main/assets/settings.png)

## Commands

| Command                   | What it does                                      |
| ------------------------- | ------------------------------------------------- |
| `/advisor`                | Enable the flow; choose available models when needed. |
| `/advisor-manual [focus]` | Ask for an immediate second opinion.              |
| `/advisor-models`         | Choose the Executor and Advisor models.           |
| `/advisor-settings`       | Configure behavior, context, privacy, and limits. |
| `/advisor-off`            | Disable the flow and persistent activation.       |

### Experimental Advisor Scout

Advisor Scout is off by default. When enabled, the Executor model first selects relevant conversation history before the Advisor sees it. This adds a model call, latency, and cost. See the [configuration guide](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/configuration.md) for details.

## Privacy

Advisor requests can include user messages, tool calls, tool results, and repository information. `/advisor-settings` controls context, tool disclosure, redaction, and explicit file handoff. Secret redaction is off by default, and tools without an explicit policy use full context. Settings are global, so a project cannot silently change them.

Read [Privacy and data handling](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/privacy.md) before using pi-advisor with sensitive work.

## Documentation

- [Configuration and automatic loop gates](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/configuration.md)
- [Privacy and data handling](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/privacy.md)
- [Development](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/development.md)
- [Benchmarking](docs/benchmark.md)
- [Changelog](CHANGELOG.md)
- [MIT License](LICENSE)
- [npm package](https://www.npmjs.com/package/pi-advisor-flow)
- [Why use an Advisor flow?](https://philipbrembeck.com/writings/2026/07/only-as-much-intelligence-as-you-need)
