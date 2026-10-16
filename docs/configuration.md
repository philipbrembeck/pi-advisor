# Configuration

Use `/advisor-models` and `/advisor-settings` to configure pi-advisor. Both commands save to the global `advisor.json` in the Pi agent directory. `/advisor-settings` uses Pi's compact searchable settings list: type to fuzzy-search a control, press Enter or Space to change it, and every valid change is saved immediately.

Repository-controlled project `advisor.json` files are not applied. Models, prompts, gates, budgets, disclosure, redaction, integrations, and consent remain under the user's global configuration.

`/advisor` also accepts `executor=`, `advisor=`, and `contextMaxChars=` overrides for the current activation. For example, `/advisor contextMaxChars=30000` sets the reconstructed-history limit; use `0` for no history. The `ALL` option in settings represents the complete current branch and remains subject to the Advisor model's context limit. When `executor` is unset, the Executor is the current Pi session model and thinking level (unless `executorEffort` is set); `/advisor` does not switch models. On first use, or when the saved Advisor ref is missing from the configuration or Pi's available model list, `/advisor` opens the available-model picker instead of silently choosing an unconfigured model. An explicit `executor` that is no longer available is picked again; choose **Current session model** to clear it. Selected refs are persisted only after the models pass activation checks.

All fields are optional. The model refs below are explicit examples of models available through your configured providers; omit them to choose models interactively with `/advisor`. Disclosure and redaction fields are explained in [Privacy and data handling](privacy.md).

```json
{
  "executor": "provider/executor-model",
  "advisor": "provider/advisor-model",
  "advisorFallbackModel": "provider/backup-advisor-model",
  "executorEffort": "medium",
  "advisorEffort": "xhigh",
  "contextMaxChars": 25000,
  "advisorModelWhitelist": [
    "provider/fast-executor",
    "provider/frontier-executor"
  ],

  "advisorPlanGate": true,
  "advisorFailureGate": true,
  "advisorCompletionGate": true,
  "advisorCustomInvocation": "before changing a production deployment",
  "advisorCollapseResponses": false,

  "advisorAutoLoopGate": true,
  "advisorLoopThreshold": 3,
  "advisorMaxCallsPerSession": 5,
  "advisorBlockOnBlocked": true,
  "gateFailureMode": "block-session",

  "advisorSessionSummary": false,
  "advisorScoutEnabled": false,
  "showUsageDetails": true,
  "showUsageFooter": false,
  "advisorGitContext": "summary",
  "advisorGitContextMaxChars": 20000,
  "simpleMode": false,
  "advisorToolsEnabled": true,
  "alwaysOn": false,
  "advisorHerdrIntegration": true,
  "advisorToolResultMaxLines": 2000,
  "advisorToolResultMaxBytes": 51200,

  "advisorRedactSecrets": false,
  "advisorAgentsMdContext": true,
  "advisorTrackedFileContent": false,
  "advisorUntrackedContent": false,
  "advisorDisableSameModel": true,
  "advisorOutcomeLogging": false,
  "advisorJevTransport": "typesafe-compatible",
  "advisorJevBaseUrl": "https://api.codiv.ai",
  "advisorJevKeyProvider": "openrouter",
  "advisorToolPolicies": {
    "bash": "summary",
    "deploy": "exclude"
  }
}
```

## Advisor fallback model

`advisorFallbackModel` is optional and empty by default. Select it from **Fallback Advisor model** in `/advisor-settings` or the optional slot in `/advisor-models`. When the primary Advisor cannot resolve credentials or the provider request fails, pi-advisor retries once with the fallback using the same privacy settings, model whitelist, budget reservation, and prepared request payload. A successful fallback counts as one consultation, not two, and the response is attributed to the model that answered. User cancellation, same-model suppression, and request-preparation failures do not silently bypass their existing controls. If both attempts fail, the combined primary and fallback error is surfaced. A fallback equal to the active Executor is skipped with a notice.

## Same-model consultations

`advisorDisableSameModel` defaults to `true`. When the active Executor model is the same provider/model as the configured Advisor, `ask_advisor` returns a skipped result without calling the provider, screening with Jev, consuming a consultation, or using a tracked-file handoff. Manual calls and automatic gates are skipped too; they never create a tool or session block. The active model (including models selected by `/model`) is compared, not just the saved Executor setting. `/advisor`, `/advisor-models`, and model selection re-check the match and show a notice on transitions. Turn this setting off in `/advisor-settings` if you want a same-model consultation with a different reasoning level.

## Follow-up consultations

Pass `followUpTo` with a new non-empty `question` to `ask_advisor` to continue an existing response. The tool reuses the exact post-redaction payload prefix captured for that `adviceId` and appends only the follow-up question, so Scout does not rebuild the conversation. Jev screening, same-model suppression, the whitelist, current privacy policy, and the shared call budget still apply. Follow-ups count once against `advisorMaxCallsPerSession` and render a distinct follow-up usage line.

Payloads are session-local and never persisted. They expire after five minutes, are cleared on a new user turn or after three subsequent non-Advisor tool results, and stop after three chained follow-ups. Reuse is bound to the original project directory, trust state, and disclosure settings. A successful follow-up advances the chain to a new `adviceId`; expired or unknown IDs return guidance to issue a fresh consultation. Follow-ups cannot add a draft, Git context override, or file attachments; use a fresh consultation for those.

## Advisor model whitelist

`advisorModelWhitelist` is an optional global array of exact `provider/model` references. When it contains one or more entries, the Advisor tool and every automatic Advisor path are available only while the current Executor model matches one of those entries. A missing current model is denied when the list is non-empty. An empty list (the default) allows every model for backward compatibility. The same restriction applies even when `ask_advisor` is present in the active tool list.

The `/advisor-settings` row opens a searchable multi-select menu containing the models configured in Pi. Type to fuzzy-filter the list, use Space to toggle models, and press Enter to apply. The setting is checked before budgets, repeated-call tracking, Jev screening, or any Advisor provider request, so a denied model neither spends Advisor budget nor triggers a gate. Matching is exact and case-sensitive.

## Simple mode and persistent activation

- `simpleMode` defaults to `false`. When enabled, `ask_advisor` remains available for voluntary second opinions when Advisor tools are enabled, and `/advisor-manual` remains available. Plan/failure/completion rules, loop gates, blocking, call budgets, and session summaries are disabled. Context limits, result caps, redaction, and tool disclosure policies still apply.
- `advisorToolsEnabled` defaults to `true` to preserve on-demand tool access. When `false`, Pi removes `ask_advisor` and `record_advisor_outcome` from the active tool set for new, resumed, forked, and reloaded sessions. This explicit opt-out takes precedence over `alwaysOn`. Re-enable tools in `/advisor-settings`, or run `/advisor`; the latter clears the opt-out only after successful activation.
- `alwaysOn` defaults to `false` and controls automatic flow activation separately from tool availability. When enabled and Advisor tools are enabled, Pi restores the configured Executor, if any, and activates the flow for new, resumed, forked, and reloaded sessions. If model refs are missing or unavailable, startup reports the problem without activating; run `/advisor` to choose available models interactively. A native subagent launcher that sets `PI_SUBAGENT_CHILD=1` keeps its host-selected model and thinking level; Advisor tools still activate, but the child is not switched to the parent Executor.
- With a pinned `executor`, an explicit `/model` selection made before `/advisor` is held for that session and adopted as the Executor on the next successful activation, and while the Advisor flow is active it is persisted as the Executor immediately. Without a pinned `executor`, `/model` only changes the session model, which the Executor follows. A model restored with a session or selected by cycling does not change the saved Executor.
- `/advisor-off` persists `advisorToolsEnabled: false` and turns `alwaysOn` off, keeping model-facing Advisor tools disabled in later sessions. `/advisor-manual` remains available.
- In Simple mode, settings keeps the Context window/history, Advisor tools, Simple mode, and Always on controls. Advanced values remain saved and take effect when Simple mode is disabled.
- Settings changes are applied and persisted as they happen; Escape closes the screen without a separate Save action.

## Experimental Advisor Scout

`advisorScoutEnabled` defaults to `false` and can only be loaded from the global `advisor.json`. The `Experimental Advisor Scout` row appears in advanced `/advisor-settings`. Simple mode hides the row without changing its saved value.

When enabled, Scout runs before Executor-requested `ask_advisor` calls, `/advisor-manual`, and automatic gates. It resolves the Executor model (the session model unless `executor` is set) and `executorEffort`; it never substitutes the Advisor model or another model. The extra call adds latency and provider cost.

Scout receives at most 64 KiB of serialized manifest data in 64 protocol-safe groups, with a 24 KiB limit per group and bounded labels. It may select at most 32 groups and return up to 4 KiB of synthesis. The synthesis is labelled as untrusted inference and never replaces selected verbatim evidence. Required current-request context is always retained. The reconstructed Advisor conversation has a separate `contextMaxChars` budget, so manifest metadata does not consume that budget. If required context cannot fit either hard limit, Scout is skipped.

Scout has a 30-second total timeout. Missing model or authentication, provider errors, timeouts, invalid JSON, duplicate group IDs, and over-budget output produce a visible fallback. Unknown selected group IDs are ignored, required groups are retained automatically, and optional selections are trimmed to the selection limit. Fallback sends the exact original conversation to the Advisor and does not change the gate decision, blocking policy, Herdr state, or Advisor-call budget. Cancelling the parent operation stops Scout and prevents the Advisor call from starting.

Scout usage, latency, selection counts, pre-Scout omissions, and fallback reasons are displayed separately from Advisor usage. Usage and cost details are shown by default; set `showUsageDetails` to `false` to hide details from extension-rendered Advisor, Scout, and gate output without changing usage accounting or Pi's `/cost` totals. The cumulative Advisor footer is controlled independently by `showUsageFooter`, which defaults to `false`. Both settings apply immediately when saved and do not require a reload. These displays remain local and ephemeral and are not included in Session Advisor Summary or Herdr reports.

## Context and limits

- `contextMaxChars` defaults to `15000`. It preserves complete semantic entries and adds an omission marker rather than splitting a message.
- Set `contextMaxChars` to `0` to omit reconstructed history. `9007199254740991` is the persisted value for `ALL`.
- Tool results default to Pi's `2000` lines and `50 KiB` limits. Oversized results preserve their beginning and end with an omission marker.
- `advisorLoopThreshold` is an integer of at least `2`; its default is `3`.
- Omit `advisorMaxCallsPerSession` for an unlimited shared budget. Otherwise it must be a non-negative safe integer.

## AGENTS.md and Advisor preferences

`advisorAgentsMdContext` defaults to `true`. In a trusted project, each Advisor call may include the project-root `AGENTS.md` and the global `~/.pi/agent/AGENTS.md` when present. Each source is origin-labelled, redacted when `advisorRedactSecrets` is enabled, capped at 8 KiB, and included in a combined 16 KiB rules budget. The Advisor receives them in a separate untrusted `<project_rules>` block as review guidance, never as executable instructions.

An untrusted project sends neither rules file; the Advisor is told that rules were withheld rather than being shown an apparently rule-free project. The global rules file is never sent for an untrusted project. Turn the setting off to restore the previous behavior.

`.pi/advisor-preferences.md` remains separate: it is an explicit, Advisor-specific project brief, while `AGENTS.md` supplies general project/global conventions. Both are untrusted context, and neither can override the Advisor system instructions; the explicit preferences brief is more specific when the two sources conflict.

## Consultation responses

Normal consultations preserve the provider's final Markdown and never block execution. If the Advisor explicitly says it cannot review a specifically named file, the Executor may make a sequential follow-up call with `includeTrackedFiles` when global tracked-file consent is enabled; this is discretionary, not an automatic retry. When the Advisor has no material concern or recommendation, it may begin with the exact first line `Verdict: sound`. Pi renders that response with the static `◆ ADVISOR · SOUND` header for both `ask_advisor` results and `/advisor-manual`.

## Jev/Decisions consultation filter

`advisorJevFilterEnabled` defaults to `false`. When enabled, one typed screening request checks each `ask_advisor` invocation. Only requests classified as both negligible-stakes and self-answerable are skipped; all others reach the Advisor unchanged.

The classifier selection and filter are separate settings rows. **Jev classifier** opens a searchable list of Pi classifier models whose providers have usable Pi authentication, plus the explicit **Jev API Key** option. Each selection is live-verified before it is saved. The **Jev/Decisions consultation filter** row only switches screening on and off; it stays off until an available classifier is selected. A classifier that later becomes unavailable fails open at runtime.

- **Classifier selection**: `/advisor-settings` → **Jev classifier** offers available Pi classifier models identified by concrete `provider/model` refs. Provider authentication remains Pi-managed. Prices shown in the picker are the live Pi catalog input/output rates per million tokens; pricing metadata is not copied into `advisor.json`.
- **Legacy settings**: existing `advisorJevTransport`, `advisorJevModel`, endpoint, provider, and `advisorJevPricePerMtok` fields are preserved for rollback compatibility but no longer route classifier calls or price native calls. Legacy settings/credentials are not automatically migrated into Pi authentication.
- **Custom classifier endpoints**: Pi's `models.json` chat-compatible endpoint configuration does not register a classifier implementation. Install/configure a Pi provider extension that registers a classifier model and implementation, then select it from the picker.
- **Jev API Key isolation**: selecting **Jev API Key** prompts for a masked TypeSafe key and sends it only as a request-scoped Pi classifier `apiKey`. It is stored in a separate `pi-advisor-jev-classifier` secure-store namespace (or a dedicated mode-0600 file fallback). No legacy Jev secret, environment variable, Pi provider login, or plaintext `advisor.json` key is read or migrated by this path.
- **API-key choice verification**: the explicit API-key flow locates Pi's built-in `typesafe/jev-latest` classifier even when Pi has no TypeSafe login. The submitted key is passed directly to that request and stored only after a successful live check. A missing stored key fails open; it never falls back to Pi authentication or legacy credentials.
- **Evidence and thresholds**: classifiers receive only the existing redacted and bounded Jev state, with no Git context, attachments, images, Scout output, or session summaries. Native bool probabilities and three-label stakes distributions feed the existing thresholds. Malformed results, missing models, provider errors, and timeouts fail open; caller cancellation propagates.
- **Pricing and totals**: Pi's model catalog input/cache rates price classifier input and cache tokens. JEV output tokens are always free and output cost is forced to zero even when catalog metadata contains an output rate. Missing usage is shown as unavailable; explicit zero input rates stay zero. Screening usage is combined once with Advisor usage in the `ask_advisor` tool result and Pi's generic tools cost bucket. Manual and turn-gate classifier usage remains local-only because Pi has no supported lifecycle cost aggregation API.

- **Fail-open and repeats**: a missing key, authentication failure, timeout, network error, or malformed response lets the consultation run; the outage is surfaced once per distinct failure. Exact repeats are still handled locally and free, even when filtering is off. `advisorJevFilterOverrideWindow` defaults to 10 turns; force-after-skip and automatic passthroughs are counted in the Session Advisor Summary. Skipped calls do not consume `advisorMaxCallsPerSession`.
- **Timeout**: `advisorJevTimeoutMs` (8000 ms by default) is a hard wall-clock deadline. Native classifier calls disable provider retries so cancellation and deadlines remain bounded. A skip consumes no Advisor-call budget.

## Proactive Jev classifier turn gate

`advisorJevTurnGateEveryTurns` defaults to `0` (off). When set to N, every Nth completed turn **without a consultation** asks the selected Jev classifier whether a senior advisor should weigh in now. A confident yes (`advisorJevTurnGateNoulThreshold`, default `0.8`) runs a real Advisor consultation delivered as a steer message between turns; a no, uncertainty, or provider failure keeps the status quo. Turn-gate consultations consume the shared `advisorMaxCallsPerSession` budget, appear in the Session Advisor Summary under trigger `turn-gate`, and reset the without-consultation counter.

## Automatic loop gate

The optional loop gate detects consecutive calls with the same normalized tool signature. By default, it consults the Advisor after three repeats.

Unlike ordinary consultations, a loop-gate reply must start with exactly one decision header:

```text
Decision: proceed
Decision: revise
Decision: blocked
```

| Decision  | Effect                                              |
| --------- | --------------------------------------------------- |
| `proceed` | Reset the repeat counter and allow the tool action. |
| `revise`  | Block the repeated tool action.                     |
| `blocked` | Apply the configured gate-failure policy.           |

Malformed, missing, duplicate, or contradictory decisions are gate failures. The same policy applies when the Advisor is unavailable or the shared call budget is exhausted.

| Failure mode              | Effect                              |
| ------------------------- | ----------------------------------- |
| `block-session` (default) | Block the session.                  |
| `block-tool`              | Block only the current tool action. |
| `warn-and-continue`       | Show a warning and continue.        |

| Condition | `block-session` | `block-tool` | `warn-and-continue` |
| --- | --- | --- | --- |
| Advisor unavailable or timed out | Block session | Block tool action | Warn and continue |
| Missing, malformed, duplicate, or contradictory decision | Block session | Block tool action | Warn and continue |
| Shared budget exhausted | Block session | Block tool action | Warn and continue |
| `Decision: blocked` | Block session | Block tool action | Warn and continue |

`advisorBlockOnBlocked` controls whether a session block immediately aborts the active run. It never turns a session block into a tool-only block. A recorded session block remains fail-safe after `/advisor-off`; start a new session to resume tool execution.

See [Privacy and data handling](privacy.md) for repository context, disclosure, redaction, and integrations.
