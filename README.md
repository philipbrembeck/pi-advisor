# pi-advisor

An on-demand Advisor model flow for autonomous **Pi** coding agents.

This extension introduces a strategic "Executor/Advisor" workflow, inspired by Claudes [Advisor](https://code.claude.com/docs/en/advisor).

The primary agent (the Executor) acts, writes code, and executes tools. Whenever the Executor encounters high risk, ambiguity, or potential loops, it MUST escalate the scenario to a smarter, second-opinion LLM (the Advisor) for strategic guidance.

[Read more about it here](https://philipbrembeck.com/writings/2026/07/only-as-much-intelligence-as-you-need).

## Installation

Install the package directly into your global Pi agent environment:

### From NPM

```bash
pi install npm:pi-advisor-flow
```

### From Git

```bash
pi install git:github.com/philipbrembeck/pi-advisor.git
```

### From Local Folder (For Development)

```bash
pi install /path/to/pi-advisor
```

## Usage & Commands

Once installed, the following commands are available inside the Pi terminal:

### `/advisor`

Enables the Advisor flow. Switches the primary model to the configured Executor model and registers the `ask_advisor` tool.

- _Example:_ `/advisor executor=anthropic/claude-sonnet-5 advisor=openai/gpt-5.6-sol`

### `/advisor-models`

Opens an interactive, scrollable fuzzy-search picker in the TUI to choose:

1. Executor Model & Reasoning Effort
2. Advisor Model & Reasoning Effort

Saves and persists your configuration to `~/.pi/agent/advisor.json`.

### `/advisor-off`

Disables the Advisor flow, removing the `ask_advisor` tool from the active session.

## Local Development

`pi-advisor` uses Bun for rapid testing and TypeScript. Standard commands apply:

### 1. Clone the repository

```bash
git clone git@github.com:philipbrembeck/pi-advisor.git
cd pi-advisor
```

### 2. Install dependencies

```bash
bun install
```

### 3. Run type-checks & tests

Verify code-splitting correctness and registration logic:

```bash
bun test            # Run unit tests
npm run typecheck   # Perform strict TS checks
```
