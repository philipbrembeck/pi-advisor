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

It also configures Advisor reasoning effort, whether long Advisor responses collapse to a short preview (`Ctrl+O` expands them), and each built-in invocation gate independently (consequential plans, repeated failures, and completion review). It includes controls for critical-response blocking, the automatic loop gate and its repeat threshold, a per-session Advisor-call limit, and the local Session Advisor Summary. Response collapsing is off by default. You can add one custom natural-language invocation rule. Settings persist in `advisor.json`.

### `/advisor-models`

Opens an interactive, scrollable fuzzy-search picker in the TUI to choose:

1. Executor Model & Reasoning Effort
2. Advisor Model & Reasoning Effort

Saves and persists your configuration to `~/.pi/agent/advisor.json`.

### `ask_advisor`

The Executor can call `ask_advisor` with an empty object for a general review of the current task and conversation, or provide `question` for targeted feedback. The Advisor is a brief second opinion: the Executor investigates and forms its own candidate direction first, then uses the Advisor to challenge assumptions and validate a consequential next step. It should not delegate the entire plan or task.

Normal Advisor consultations return the provider's final Markdown unchanged. They never parse JSON, synthesize a verdict, or block Executor work. Only automatic loop gates use machine-readable decisions: the first non-empty line must be `Decision: proceed`, `Decision: revise`, or `Decision: blocked`; malformed, missing, duplicate, or contradictory decisions are explicit gate failures.

### Automatic loop gate

When enabled, the loop gate consults the Advisor after the configured number of consecutive calls with the same normalized tool signature (default: three). A `proceed` decision resets the repetition counter and allows the call. `revise` blocks only the repeated tool action; `blocked` can block the session according to the configured policy. Gate failures default to `block-session` and may be changed to `block-tool` or `warn-and-continue`. Normalization is allowlisted: object keys are deterministic, arrays retain order, and only volatile IDs/timestamps, temporary paths, and safe shell whitespace are normalized.

Every manual, Executor-requested, and automatic Advisor invocation consumes one shared session budget. The default is unlimited; a finite budget appears as used/remaining in the Executor instructions and local summary. The optional Session Advisor Summary is local, in-memory only, and appears after a non-blocked settled run; it is never persisted or sent to Herdr. It separates Markdown advice from gate decisions and records trigger, model, usage/cost when available, failure, budget, and execution effect.

### Context configuration

The selected configuration is saved as `advisor.json` in the Pi agent directory (or an existing trusted project configuration). `/advisor-models` and `/advisor-settings` share this file:

```json
{
  "executor": "openai/gpt-5.6-luna",
  "advisor": "anthropic/claude-fable-5",
  "executorEffort": "medium",
  "advisorEffort": "xhigh",
  "contextMaxChars": 25000,
  "advisorPlanGate": true,
  "advisorFailureGate": true,
  "advisorCompletionGate": true,
  "advisorCollapseResponses": false,
  "advisorCustomInvocation": "before changing a production deployment",
  "advisorBlockOnBlocked": true,
  "advisorAutoLoopGate": true,
  "advisorLoopThreshold": 3,
  "advisorMaxCallsPerSession": 5,
  "advisorSessionSummary": true,
  "gateFailureMode": "block-session",
  "advisorHerdrIntegration": true,
  "advisorToolResultMaxLines": 2000,
  "advisorToolResultMaxBytes": 51200
}
```

All fields are optional. `executor`, `advisor`, and their effort settings are managed by `/advisor-models`. `/advisor-settings` manages `advisorEffort`, `contextMaxChars`, the three invocation-gate booleans, `advisorCollapseResponses`, `advisorCustomInvocation`, `advisorBlockOnBlocked`, `advisorAutoLoopGate`, `advisorLoopThreshold`, `advisorMaxCallsPerSession`, `advisorSessionSummary`, `gateFailureMode`, `advisorHerdrIntegration`, and the tool-result line/byte limits.

`contextMaxChars` is a soft character budget: it preserves complete semantic entries and adds an older-context omission marker rather than starting mid-message. Its default is 15,000, `0` omits history, and `9007199254740991` means ALL. Oversized tool results default to Pi's 2,000-line/50 KiB limits and preserve beginning/end sections with an omission marker; `advisorToolResultMaxLines` and `advisorToolResultMaxBytes` override them. `advisorLoopThreshold` must be at least `2` and defaults to `3`. Omit `advisorMaxCallsPerSession` for an unlimited shared budget; otherwise it must be a non-negative safe integer. `gateFailureMode` accepts `block-session`, `block-tool`, or `warn-and-continue`, defaulting to `block-session`. Herdr integration and the notification/activity/blocked metadata paths default to enabled; failure notifications use sanitized `notification.show` requests and can be disabled with `advisorHerdrIntegration`. Critical blocking, the automatic loop gate, and the Session Advisor Summary default to `true`. Unknown or invalid configuration keys fail at startup with the file, key, accepted values, and remediation; save operations preserve unknown fields.

### `/advisor-off`

Disables the Advisor flow, removing the `ask_advisor` tool from the active session.

## Publishing releases

CI manages `vX.Y.Z` release tags from the version in `package.json`; contributors must not create or push release tags manually. The release workflow verifies the version, type-checks, tests, and then publishes:

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
