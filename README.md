# pi-advisor

An on-demand Advisor model flow for autonomous **Pi** coding agents.

This extension introduces a strategic "Executor/Advisor" workflow. The primary agent (the Executor) acts, writes code, and executes tools. Whenever the Executor encounters high risk, ambiguity, or potential loops, it MUST escalate the scenario to a smarter, second-opinion LLM (the Advisor) for strategic guidance.

---

## 🧭 The Gating Rules

When `pi-advisor` is active, the Executor is instructed to strictly adhere to three critical Gating Rules:

### 1. 📋 PLAN GATE (Trade-offs & Design)
You **MUST** call `ask_advisor` BEFORE selecting or implementing a plan when:
- Multiple materially different approaches exist.
- Requirements are ambiguous or underspecified.
- The decision carries architectural, security, data-loss, compatibility, or difficult-to-reverse consequences.

### 2. 🛑 FAILURE GATE (Loop Detection)
You **MUST** call `ask_advisor` when:
- You repeat a failure or find yourself stuck in a loop.
- An attempted fix recreates a prior failure.
- Two consecutive actions/tool-calls produce no measurable progress.
- *Do not attempt another equivalent fix before consulting.*

### 3. 🏁 COMPLETION GATE (Review & Verification)
You **MUST** call `ask_advisor` with:
- The goal, modified files, key decisions, tests performed, results, and remaining risks **BEFORE** declaring success, finishing, or calling `goal_complete`.
- *You may skip this only for demonstrably trivial, low-risk work with no meaningful trade-offs.*

---

## 🚀 Installation

Install the package directly into your global Pi agent environment:

### From NPM
```bash
pi install npm:pi-advisor
```

### From Git
```bash
pi install git:github.com/philipbrembeck/pi-advisor.git
```

### From Local Folder (For Development)
```bash
pi install /path/to/pi-advisor
```

---

## 🛠 Usage & Commands

Once installed, the following commands are available inside the Pi terminal:

### `/advisor [executor=model] [advisor=model]`
Enables the Advisor flow. Switches the primary model to the configured Executor model and registers the `ask_advisor` tool.
- *Example:* `/advisor executor=aikeys/claude-3-5-sonnet advisor=aikeys/gpt-4o`

### `/advisor-models`
Opens an interactive, scrollable fuzzy-search picker in the TUI to choose:
1. Executor Model & Reasoning Effort
2. Advisor Model & Reasoning Effort

Saves and persists your configuration to `advisor.json`.

### `/advisor-off`
Disables the Advisor flow, removing the `ask_advisor` tool from the active session.

---

## 💻 Local Development

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
bun test         # Run unit tests
npm run typecheck # Perform strict TS checks
```

---

## 📄 License

MIT
