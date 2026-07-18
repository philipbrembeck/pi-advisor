# pi-advisor

<div align="center">
<img src="https://raw.githubusercontent.com/philipbrembeck/pi-advisor/refs/heads/main/assets/screenshot.png" alt="Pi Advisor Flow Screenshot" width="600">
</div>

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
- _Context size:_ `/advisor contextMaxChars=30000` uses up to 30,000 characters of the reconstructed conversation for each consultation. The default is 15,000; the maximum is 1,000,000. Larger values increase request cost and can exceed the advisor model's context window.

### `/advisor-models`

Opens an interactive, scrollable fuzzy-search picker in the TUI to choose:

1. Executor Model & Reasoning Effort
2. Advisor Model & Reasoning Effort

Saves and persists your configuration to `~/.pi/agent/advisor.json`.

### `ask_advisor`

The Executor can call `ask_advisor` with an empty object for a general review of the current task and conversation, or provide `question` for targeted feedback. The Advisor is a brief second opinion: the Executor investigates and forms its own candidate direction first, then uses the Advisor to challenge assumptions and validate a consequential next step. It should not delegate the entire plan or task.

### Context configuration

The selected configuration is saved as `advisor.json` in the Pi agent directory (or an existing trusted project configuration). Set `contextMaxChars` there to increase the reconstructed conversation limit for all consultations:

```json
{
  "contextMaxChars": 30000
}
```

`contextMaxChars` must be a positive integer up to 1,000,000. Its default is 15,000.

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
