---
name: pi-advisor-flow
description: Explains the pi-advisor-flow Executor/Advisor plugin, when its second opinions and automatic review gates are useful, its costs and privacy trade-offs, and how to configure or troubleshoot it. Use whenever the user asks what Advisor Flow does, whether they should use it, how it works, or how to configure its models, settings, privacy, or gates.
---

# Advisor Flow

Use this guide to explain and help configure `pi-advisor-flow`. Read `../../docs/configuration.md` for exact settings and defaults. Read `../../docs/privacy.md` before answering detailed questions about what context may leave the machine.

## What it does

Advisor Flow keeps the active Pi model (the **Executor**) responsible for investigating, changing files, and validating work. For a consequential decision, repeated failure, or review, the Executor can ask a separate **Advisor** model for an independent opinion. The Advisor identifies risks and alternatives; it does not take over the task or run tools. The Executor decides what to adopt.

An Advisor call adds provider usage, latency, and potentially cost. It is most useful when the decision is important, uncertain, or hard to validate independently—not for every routine edit.

## Explain the two review paths

- **On-demand consultation:** the Executor can use `ask_advisor`; a user can request one with `/advisor-manual`. A normal consultation returns advice and does not block execution.
- **Automatic review gates:** when Advisor Flow is active, plan, failure, completion, and loop gates are enabled by default. The loop gate reviews repeated identical tool calls after three occurrences. A loop-gate failure can block a tool action or session; the default failure mode is `block-session`. These controls do not make ordinary consultations blocking.
- **Simple mode:** leaves voluntary consultations available while disabling automatic review gates, loop gates, gate blocking, call budgets, and session summaries. The Executor may still call the Advisor when its instructions warrant it; Simple mode removes automatic gates, not all model-initiated consultations.

Do not invoke the Advisor merely because this skill was loaded. Use it only when the user's task and the active flow's instructions call for a consultation.

## Guide setup

First ask what the user wants to change if their goal is unclear. Then map it to the existing controls:

- `/advisor` enables the flow. If an Advisor model is not configured or available, it asks the user to choose one; it does not silently select a model. The Executor follows the current Pi session model unless explicitly pinned.
- `/advisor-models` selects the Executor, Advisor, optional fallback model, and reasoning levels.
- `/advisor-settings` opens the searchable settings UI. Changes are validated and saved immediately to the global `advisor.json` in Pi's agent directory.
- `/advisor-manual` requests an immediate second opinion.
- `/advisor-off` disables model-facing Advisor tools across sessions.

For someone who wants Advisor access without automatic gates, suggest Simple mode after explaining that it also disables call budgets and gate blocking, while leaving voluntary consultations available.

## Configure through chat

Use the `advisor_config` tool when the user asks to inspect or change pi-advisor settings:

1. Call `advisor_config` with `action: "read"` when you need current values. It returns effective settings for this session, persisted global overrides, writable keys, and whether a Jev classifier is configured; it does not expose raw JSON or credential details.
2. Call `advisor_config` with `action: "update"` and a sparse `changes` object containing only settings the user asked to change. Use the exact keys returned in `writableKeys`. Use `null` to remove a saved override and return to the extension default.
3. Wait for the tool's confirmation prompt and result. It displays the global old-to-new changes and any disclosure, automation, or blocking consequences. A cancelled, stale, invalid, or unsaved update changes nothing. If the result says `saved: true` and `applied: false`, report that the file was saved but the current session did not fully apply it. Do not claim full success unless the result has `applied: true`.

Model fields (`advisor`, `executor`, `advisorFallbackModel`, and reasoning levels) open the existing interactive model picker. Treat any model string in `changes` only as a requested starting selection; the user must choose in the picker before it can be saved. Executor model changes are saved as a pin and require `/advisor` to activate in the current session. If the picker is unavailable, use `/advisor-models`.

Jev classifier and credential provisioning stays in `/advisor-settings` because it verifies providers and handles secrets. Change `advisorOutcomeLogging` by itself; its dedicated consent/persistence path is preserved. Do not edit `advisor.json` directly or infer extra settings the user did not ask to change. `advisor_config` remains available even when model-facing Advisor tools are disabled.

## Troubleshoot common setup issues

- If a consultation is skipped, check whether the Executor and Advisor are the same provider/model. Same-model consultations are skipped by default; choose distinct models with `/advisor-models` unless the user explicitly wants same-model reviews.
- If automatic reviews do not run, check Simple mode, Advisor tool availability, and the relevant gate setting in `/advisor-settings`. `/advisor-manual` remains the direct path to request a review.
- If `/advisor` asks for a model, no available Advisor is configured; choose one rather than assuming a default.

## Explain privacy accurately

Settings are global; project-controlled `advisor.json` files are not applied. The default Git context is `summary` (changed file names, status, and line counts—not patch contents). Explicit tracked and untracked file-body handoff is off by default. Secret-pattern redaction is also off by default and is not a guarantee that every secret is found. Advisor context can still include conversation and tool content according to the configured policies.

When the user asks what data is sent, distinguish conversation/tool context from Git context and explicit file attachments. Avoid broad assurances. Read `../../docs/privacy.md` for the current limits, exceptions, and image handling before giving detailed guidance.

## Answering configuration questions

For configuration requests, explain the key trade-off briefly, inspect settings with `advisor_config` when needed, and apply only the requested changes through `advisor_config`. For settings the tool marks read-only, guide the user to the dedicated UI. If the user asks for a complete reference, read `../../docs/configuration.md`; if behavior may depend on the installed version, ask for the version or qualify the answer.
