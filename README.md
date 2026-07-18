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
- _Context size:_ `/advisor contextMaxChars=30000` uses up to 30,000 characters of the reconstructed conversation for each consultation. `0` disables history; `Number.MAX_SAFE_INTEGER` represents the complete branch. Larger values increase request cost and can exceed the Advisor model's context window.

### `/advisor-manual [focus]`

Starts an Advisor consultation in parallel without interrupting the Executor's active tool work. An optional `focus` is passed to the Advisor; when it completes, the advice is delivered to the Executor before its next model call. This works while the Executor is mid-turn.

### `/advisor-settings`

Opens a single keyboard-navigable settings screen. It includes a Claude Code-style context slider with `0`, `10k`, `25k`, `100k`, `200k`, and `ALL`; `0` sends no reconstructed history and `ALL` sends the complete current branch, subject to the Advisor model's context limit.

It also configures Advisor reasoning effort, whether long Advisor responses collapse to a short preview (`Ctrl+O` expands them), and each built-in invocation gate independently (consequential plans, repeated failures, and completion review). Response collapsing is off by default. You can add one custom natural-language invocation rule. Settings persist in `advisor.json`.

### `/advisor-models`

Opens an interactive, scrollable fuzzy-search picker in the TUI to choose:

1. Executor Model & Reasoning Effort
2. Advisor Model & Reasoning Effort

Saves and persists your configuration to `~/.pi/agent/advisor.json`.

### `ask_advisor`

The Executor can call `ask_advisor` with an empty object for a general review of the current task and conversation, or provide `question` for targeted feedback. The Advisor is a brief second opinion: the Executor investigates and forms its own candidate direction first, then uses the Advisor to challenge assumptions and validate a consequential next step. It should not delegate the entire plan or task.

### Context configuration

The selected configuration is saved as `advisor.json` in the Pi agent directory (or an existing trusted project configuration). `/advisor-models` and `/advisor-settings` share this file:

```json
{
  "executor": "aikeys/claude-sonnet-5",
  "advisor": "aikeys/claude-fable-5",
  "executorEffort": "high",
  "advisorEffort": "high",
  "contextMaxChars": 25000,
  "advisorPlanGate": true,
  "advisorFailureGate": true,
  "advisorCompletionGate": true,
  "advisorCollapseResponses": false,
  "advisorCustomInvocation": "before changing a production deployment"
}
```

All fields are optional. `executor`, `advisor`, and their effort settings are managed by `/advisor-models`. `/advisor-settings` manages `advisorEffort`, `contextMaxChars`, the three gate booleans, `advisorCollapseResponses`, and `advisorCustomInvocation`. `contextMaxChars` must be a non-negative safe integer: its default is 15,000, `0` omits history, and `9007199254740991` means ALL.

### `/advisor-off`

Disables the Advisor flow, removing the `ask_advisor` tool from the active session.

## Publishing releases

Pushing a version tag (`vX.Y.Z`) runs the release workflow. It verifies that the tag matches `package.json`, type-checks, tests, then publishes:

- `pi-advisor-flow` to [npm](https://www.npmjs.com/package/pi-advisor-flow)
- `@philipbrembeck/pi-advisor-flow` to GitHub Packages, which makes the package appear in this repository’s **Packages** sidebar

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
bun run typecheck   # Perform strict TS checks
```
