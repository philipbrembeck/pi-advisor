# [pi-advisor](https://github.com/philipbrembeck/pi-advisor)

<div align="center">

[![Watch the 40 second reel](https://raw.githubusercontent.com/philipbrembeck/pi-advisor/refs/heads/main/assets/reel-poster.png)](https://github.com/user-attachments/assets/ef18666e-05da-4fb7-a541-53494a28e2fb)

A configurable second-opinion workflow for <a href="https://github.com/earendil-works/pi">Pi</a> coding agents, inspired by the ["Steering Black-Box LLMs with Advisor Models" paper](https://arxiv.org/abs/2510.02453) and Claude's [Advisor](https://code.claude.com/docs/en/advisor) feature.

</div>

![Downloads](https://img.shields.io/npm/d18m/pi-advisor-flow?style=flat) ![NPM Version](https://img.shields.io/npm/v/pi-advisor-flow?style=flat) ![Pi Advisor Flow badge](https://img.shields.io/badge/advisor%20flow-fff?logo=pi&logoColor=000)

`pi-advisor-flow` keeps one model focused on execution and makes a second, smarter model available for consequential decisions, stalled work, and final reviews. The Executor still owns the work. The Advisor challenges assumptions, exposes risks, and suggests verification steps without taking over or running tools.

Keep implementation on a fast model and borrow frontier reasoning only when decisions matter. [Read why this workflow is useful](https://philipbrembeck.com/writings/2026/07/only-as-much-intelligence-as-you-need).

## Features

- **On-demand second opinions** through the `ask_advisor` tool or `/advisor-manual`.
- **Configurable review gates** before plans, after repeated failures, and before declaring completion.
- **Automatic loop detection** for repeated tool calls, with explicit proceed, revise, or blocked decisions.
- **Separate model and reasoning controls** for the Executor and Advisor, with same-model consultations skipped by default to avoid redundant calls.
- **Optional Advisor fallback model** that retries provider, auth, and availability failures once without consuming a second consultation budget slot.
- **Cached Advisor follow-ups** through `followUpTo`, reusing a short-lived, redacted payload prefix for focused questions.
- **Model whitelist** that can restrict Advisor calls to exact `provider/model` Executor references.
- **Advisor usage accounting** with per-response token and cost details, normalized usage in Pi's `/cost` totals, and an optional cumulative footer.
- **Outcome reporting** through `/advisor-stats`, with adoption and validation comparisons over the retained ledger window.
- **Privacy controls** for conversation history, repository context, trusted `AGENTS.md` rules, explicit file and image handoff, tool results, secret redaction, and outcome logging.
- **Visual Advisor reviews** for supported PNG, JPEG, GIF, and WebP images in selected conversation or tool results when the Advisor model accepts images.
- **Optional persistent activation, Simple mode, session summaries, and Herdr integration.**
- **Compact searchable `/advisor-settings`** that matches Pi's settings list and saves changes immediately.
- **Experimental Advisor Scout** that uses the configured Executor model to curate conversation evidence before every Advisor call.
- **Optional Jev/Decisions consultation filter and proactive turn gate**: typed screening can skip low-stakes, self-answerable consultations or proactively pull in the Advisor. The **Jev provider** row in `/advisor-settings` chooses TypeSafe, an existing OpenRouter login, OpenAI Decisions (`gpt-6-luna`; `advisorJevTransport: "openai-decisions"`), or any System One–compatible endpoint of your own (`advisorJevBaseUrl`) — a corporate gateway, a compatible third-party host, or a decision model on `localhost`. Every provider is live-verified before it is saved, and `auto` never picks the custom endpoint; OpenAI Decisions requires an OpenAI Platform API key, not ChatGPT subscription OAuth. Guided setup stores entered keys securely. Both features are off by default.

## How it works

1. The Executor investigates the task and forms its own candidate direction.
2. For a consequential decision, stalled attempt, or final review, it calls `ask_advisor` or an enabled gate starts a review.
3. pi-advisor reconstructs the relevant conversation and allowed repository context.
4. The Advisor returns an opinion with risks, alternatives, and verification steps.
5. The Executor decides what to adopt, changes the code, and validates it.

Regular consultations never block execution. Automatic loop gates are different: they evaluate repeated tool calls and can stop a tool action or session based on your configured failure policy.

## Install

Requires Pi 1.0.0+ (1.x).

```bash
pi install npm:pi-advisor-flow
```

For npm consumers who want to test the latest development preview:

```bash
npm install pi-advisor-flow@dev
```

Preview builds use the next patch prerelease version (for example, `0.8.1-dev.1` after stable `0.8.0`) and are published only when a file included in the npm package changes. Each preview advances the `dev.N` sequence. Regular installs continue to use the stable `latest` version.

You can also install from GitHub:

```bash
pi install git:github.com/philipbrembeck/pi-advisor.git
```

Reload Pi after installing.

## Quick start

```text
/advisor            # Enable the Advisor Flow
/advisor-models     # Choose the Executor, Advisor, and optional fallback models
/advisor-settings   # Configure behavior, modes, etc.
/advisor-stats      # Show retained outcome adoption and validation stats
```

On first use, or whenever a saved model is unavailable, `/advisor` opens the same available-model picker as `/advisor-models`; it never silently chooses an unconfigured model. If the active Executor and Advisor use the same provider/model, calls and automatic gates are skipped with a notice; switching either model resumes consultations. Turn off **Disable same-model Advisor** in `/advisor-settings` (or set `"advisorDisableSameModel": false` globally) if you intentionally want a higher-effort review from that same model. You can also enable the flow and select both models at once:

```text
/advisor executor=openai-codex/gpt-5.6-luna advisor=openai-codex/gpt-5.6-sol
```

From the Executor, `ask_advisor({})` requests a general review. A targeted `question` or concise `draft` can focus the review on a particular decision. `/advisor-settings` can restrict this tool and every automatic Advisor gate to a whitelist of exact `provider/model` Executor references; an empty whitelist preserves the default of allowing every model.

In the Settings, enable Simple Mode for a quick start.

![Pi Advisor Settings Panel](https://raw.githubusercontent.com/philipbrembeck/pi-advisor/refs/heads/main/assets/settings.png)

Unknown fields in `advisor.json` are preserved for forward compatibility and reported as non-blocking warnings. Invalid recognized values fail their own Advisor call with a clear message instead of blocking every tool call.

## Pi Codemode

With Pi Codemode enabled and the Advisor flow active, call the existing tool through `tools.ask_advisor`; no separate review tool or workflow is needed:

```js
const commands = ["bun test", "bun run typecheck"];
const checks = await Promise.all(
  commands.map(async (command) => {
    const result = await tools.bash({ command });
    return {
      command,
      exit_code: result.exit_code,
      truncated: result.truncated,
    };
  })
);
return await tools.ask_advisor({
  draft: JSON.stringify({
    checks,
    remainingRisk: "Runtime behavior needs review.",
  }),
  gitContext: "full",
});
```

Gather and filter deterministic results before paying for Advisor reasoning. Nested results are not transcript entries, so they are not automatically available to reconstructed Advisor context. Use the existing `draft` for permitted, concise summaries (8 KiB after optional redaction); these remain untrusted Executor claims, not independently verified evidence. `question` can focus a specific decision; omit it for general reviews. Use `gitContext` for patches so the user's configured disclosure ceiling applies, rather than copying a diff into the draft.

Codemode receives `{ text, adviceId?, advisor?, followUp?, usage?, jev?, skipReason? }`. `text` preserves Advisor Markdown or the existing skip notice; `usage` is the same normalized snapshot shown in response details. Skipped calls have no new `adviceId`. Provider failures and blocked calls reject. Regular consultations never become loop-gate decisions. Interactive responses and usage accounting are unchanged.

Draft text is explicit disclosure: it does **not** inherit the policies of the tools that produced it. Do not copy excluded tool output, secrets, or unconsented file bodies into `draft` or `question`. The selected Jev/Decisions provider may also receive the draft when screening is enabled. See [Privacy and data handling](docs/privacy.md).

## Usage and accounting

Advisor responses show provider-reported input, output, cache, and cost details when available. Successful `ask_advisor` calls also carry normalized usage into Pi's built-in `/cost` totals. Manual consultations and automatic gates keep their own session-local accounting instead, so nothing is double-counted. Missing or partial provider usage is shown as unavailable rather than fabricated as zero. `/advisor-settings` controls both the per-response details and the optional cumulative footer independently. Configure `advisorFallbackModel` or choose **Fallback Advisor model** in the model/settings pickers to retry one failed primary request; the final response is labelled with the model that answered, and both failures are shown together.

Jev/Decisions token usage stays in local session summaries. TypeSafe/OpenRouter/System One–compatible costs use the configurable estimate; OpenAI Decisions token counts are recorded with cost shown as unavailable until endpoint-specific billing is confirmed.

A follow-up reuses only the original post-redaction payload in memory. It expires after five minutes, is cleared by a new user turn or three subsequent non-Advisor tool results, and allows at most three chained follow-ups. Use a fresh consultation when it expires or when you need new repository context or attachments.

`/advisor-stats` reads the local outcomes ledger and reports trigger counts, adoption, followed-versus-rejected validation pass rates, distinct pseudonymous advice hashes, and the retained time window. It never fabricates historical cost data; the ledger is capped at 1 MiB and rewritten on overflow.

Successful calls return an opaque `adviceId`. If global outcome logging is enabled, the Executor can call `record_advisor_outcome` once to record whether the advice was adopted and whether final validation passed. A later `ask_advisor` call can pass that ID as `followUpTo` with a new question; the follow-up is counted once against the session budget and shows its responding model and follow-up status.

## Commands

| Command | What it does |
| --- | --- |
| `/advisor` | Enable the flow; choose available models when needed. |
| `/advisor-manual [focus]` | Ask for an immediate second opinion. |
| `/advisor-models` | Choose the Executor, Advisor, and optional fallback models. |
| `/advisor-settings` | Configure behavior, models, context, privacy, and limits. |
| `/advisor-stats` | Show retained outcome adoption and validation stats. |
| `/advisor-off` | Disable the flow and persistent activation. |

In the interactive TUI, `/advisor-manual [focus]` opens a centered overlay with the focus text prefilled, a choice of permitted Git-context level, and live progress in the transcript. Canceling has no side effects.

### Experimental Advisor Scout

Advisor Scout is off by default. When enabled in `/advisor-settings` or via `"advisorScoutEnabled": true`, the Executor model first selects relevant conversation history before the Advisor sees it. Scout runs in a separate model call, which adds cost and latency up front but can shrink the Advisor call. A bounded result shows the model, selection counts, and usage; on any failure it falls back to sending the original conversation unchanged. This experiment adapts the context-boundary idea from Zhang et al., ["FastContext: Training Efficient Repository Explorer for Coding Agents"](https://arxiv.org/html/2606.14066v1) — it curates conversation history only and is not a reproduction of FastContext. See the [configuration guide](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/configuration.md) for details.

## Privacy

Advisor requests can include user messages, tool calls, tool results, targeted questions, trusted project and global `AGENTS.md` rules, and repository information. `advisorAgentsMdContext` is on by default and can be disabled in `/advisor-settings`; rules are sent as origin-labelled, capped, redacted, untrusted review guidance only. Untrusted projects withhold both rule files and tell the Advisor that rules were withheld. Repository context is configurable from no access through changed-file summaries to a capped patch; when it is disabled, the Advisor is told so rather than shown an apparently clean tree. Images from disclosed conversation and full-policy tool results can be sent as pixels only to image-capable Advisor models; Scout sees markers, not pixels. Exact tracked and untracked image files can be attached using `includeTrackedFiles` and `includeUntracked` under their existing separate global consent rules. Images are limited to four and 8 MiB total, with a 4 MiB per-image cap; unsupported, missing, or oversized images are reported as withheld, not reviewed. Explicit tracked and untracked file contents require separate global opt-ins and are sent as untrusted data. Secret redaction is off by default; when enabled, credential-shaped values in targeted questions are redacted before the provider request. Tools without an explicit policy use full context. Settings are global, so a project cannot silently change them.

When Scout is enabled, the Executor model provider also receives bounded Advisor-eligible conversation history. Pi's `buildContextEntries()` projection is used when available. OMP-compatible session managers without that API are supported through the active branch, with the latest reset boundary and compaction's retained range applied before history or images are disclosed; cleared and compacted-out entries are not forwarded. Read [Privacy and data handling](https://github.com/philipbrembeck/pi-advisor/blob/main/docs/privacy.md) before using pi-advisor with sensitive work.

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
