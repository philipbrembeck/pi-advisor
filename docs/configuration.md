# Configuration

Use `/advisor-models` and `/advisor-settings` to configure pi-advisor. Both commands save to the global `advisor.json` in the Pi agent directory. `/advisor-settings` uses Pi's compact searchable settings list: type to fuzzy-search a control, press Enter or Space to change it, and every valid change is saved immediately.

Repository-controlled project `advisor.json` files are not applied. Models, prompts, gates, budgets, disclosure, redaction, integrations, and consent remain under the user's global configuration.

`/advisor` also accepts `executor=`, `advisor=`, and `contextMaxChars=` overrides for the current activation. For example, `/advisor contextMaxChars=30000` sets the reconstructed-history limit; use `0` for no history. The `ALL` option in settings represents the complete current branch and remains subject to the Advisor model's context limit. On first use, or when either saved model ref is missing from the configuration or Pi's available model list, `/advisor` opens the available-model picker instead of silently choosing an unconfigured model. The selected Executor and Advisor refs are persisted only after both models pass activation checks.

All fields are optional. The model refs below are explicit examples of models available through your configured providers; omit them to choose models interactively with `/advisor`. Disclosure and redaction fields are explained in [Privacy and data handling](privacy.md).

```json
{
  "executor": "provider/executor-model",
  "advisor": "provider/advisor-model",
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
  "alwaysOn": false,
  "advisorHerdrIntegration": true,
  "advisorToolResultMaxLines": 2000,
  "advisorToolResultMaxBytes": 51200,

  "advisorRedactSecrets": false,
  "advisorTrackedFileContent": false,
  "advisorUntrackedContent": false,
  "advisorOutcomeLogging": false,
  "advisorToolPolicies": {
    "bash": "summary",
    "deploy": "exclude"
  }
}
```

## Advisor model whitelist

`advisorModelWhitelist` is an optional global array of exact `provider/model` references. When it contains one or more entries, the Advisor tool and every automatic Advisor path are available only while the current Executor model matches one of those entries. A missing current model is denied when the list is non-empty. An empty list (the default) allows every model for backward compatibility. The same restriction applies even when `ask_advisor` is present in the active tool list.

The `/advisor-settings` row opens a searchable multi-select menu containing the models configured in Pi. Type to fuzzy-filter the list, use Space to toggle models, and press Enter to apply. The setting is checked before budgets, repeated-call tracking, Jev screening, or any Advisor provider request, so a denied model neither spends Advisor budget nor triggers a gate. Matching is exact and case-sensitive.

## Simple mode and persistent activation

- `simpleMode` defaults to `false`. When enabled, `ask_advisor` and `/advisor-manual` remain available for voluntary second opinions, while plan/failure/completion rules, loop gates, blocking, call budgets, and session summaries are disabled. Context limits, result caps, redaction, and tool disclosure policies still apply.
- `alwaysOn` defaults to `false`. When enabled, Pi restores the configured Executor and activates `ask_advisor` for new, resumed, forked, and reloaded sessions. If model refs are missing or unavailable, startup reports the problem without activating; run `/advisor` to choose available models interactively.
- An explicit `/model` selection made before `/advisor` is held for that session and adopted as the Executor on the next successful activation. While the Advisor flow is active, an explicit `/model` selection is persisted as the Executor immediately. A model restored with a session or selected by cycling does not change the saved Executor.
- `/advisor-off` turns `alwaysOn` off so the flow stays disabled in later sessions.
- In Simple mode, settings keeps the Context window/history control alongside Simple mode and Always on. Advanced values remain saved and take effect when Simple mode is disabled.
- Settings changes are applied and persisted as they happen; Escape closes the screen without a separate Save action.

## Experimental Advisor Scout

`advisorScoutEnabled` defaults to `false` and can only be loaded from the global `advisor.json`. The `Experimental Advisor Scout` row appears in advanced `/advisor-settings`. Simple mode hides the row without changing its saved value.

When enabled, Scout runs before Executor-requested `ask_advisor` calls, `/advisor-manual`, and automatic gates. It resolves the configured `executor` model and `executorEffort`; it never substitutes the Advisor model or another model. The extra call adds latency and provider cost.

Scout receives at most 64 KiB of serialized manifest data in 64 protocol-safe groups, with a 24 KiB limit per group and bounded labels. It may select at most 32 groups and return up to 4 KiB of synthesis. The synthesis is labelled as untrusted inference and never replaces selected verbatim evidence. Required current-request context is always retained. The reconstructed Advisor conversation has a separate `contextMaxChars` budget, so manifest metadata does not consume that budget. If required context cannot fit either hard limit, Scout is skipped.

Scout has a 30-second total timeout. Missing model or authentication, provider errors, timeouts, invalid JSON, duplicate group IDs, and over-budget output produce a visible fallback. Unknown selected group IDs are ignored, required groups are retained automatically, and optional selections are trimmed to the selection limit. Fallback sends the exact original conversation to the Advisor and does not change the gate decision, blocking policy, Herdr state, or Advisor-call budget. Cancelling the parent operation stops Scout and prevents the Advisor call from starting.

Scout usage, latency, selection counts, pre-Scout omissions, and fallback reasons are displayed separately from Advisor usage. Usage and cost details are shown by default; set `showUsageDetails` to `false` to hide details from extension-rendered Advisor, Scout, and gate output without changing usage accounting or Pi's `/cost` totals. The cumulative Advisor footer is controlled independently by `showUsageFooter`, which defaults to `false`. Both settings apply immediately when saved and do not require a reload. These displays remain local and ephemeral and are not included in Session Advisor Summary or Herdr reports.

## Context and limits

- `contextMaxChars` defaults to `15000`. It preserves complete semantic entries and adds an omission marker rather than splitting a message.
- Set `contextMaxChars` to `0` to omit reconstructed history. `9007199254740991` is the persisted value for `ALL`.
- Tool results default to Pi's `2000` lines and `50 KiB` limits. Oversized results preserve their beginning and end with an omission marker.
- `advisorLoopThreshold` is an integer of at least `2`; its default is `3`.
- Omit `advisorMaxCallsPerSession` for an unlimited shared budget. Otherwise it must be a non-negative safe integer.

## Consultation responses

Normal consultations preserve the provider's final Markdown and never block execution. If the Advisor explicitly says it cannot review a specifically named file, the Executor may make a sequential follow-up call with `includeTrackedFiles` when global tracked-file consent is enabled; this is discretionary, not an automatic retry. When the Advisor has no material concern or recommendation, it may begin with the exact first line `Verdict: sound`. Pi renders that response with the static `◆ ADVISOR · SOUND` header for both `ask_advisor` results and `/advisor-manual`.

## Jev consultation filter (TypeSafe)

`advisorJevFilterEnabled` defaults to `false`. When enabled, one cheap TypeSafe Jev call screens each `ask_advisor` invocation: low-stakes, self-answerable requests are skipped with a normal tool result telling the Executor to proceed on its own judgment; everything else consults the Advisor exactly as without the filter.

- **Transport**: `advisorJevTransport` = `auto` (default) prefers a dedicated TypeSafe key (Bun.secrets `pi-advisor/typesafe-api-key`, then the `TYPESAFE_API_KEY` environment variable, then pi-advisor's own `0600`-mode key file at `~/.pi/agent/typesafe_api_key`, then a hand-placed `typesafe_api_key` string in `advisor.json` — read-only and not recommended) and otherwise **reuses an existing OpenRouter login configured in Pi**. `typesafe` or `openrouter` force one chain. OpenRouter serves Jev through its Decisions API; a configured OpenRouter login is enough and no new key is needed.
- **Guided setup**: `/advisor-settings` → `Jev consultation filter` detects the transport, verifies it with one live Jev call before the flag flips on, and offers masked entry of a TypeSafe key. An entered key is stored securely by the extension itself — Bun.secrets when the runtime provides it, otherwise the `0600`-mode file `~/.pi/agent/typesafe_api_key` — after which the filter enables immediately. A plaintext `advisor.json` key is migrated into the secure store on enable. Disable and disable-and-clear paths are in the same flow; note that pi only reads `TYPESAFE_API_KEY` at launch, so a newly exported value needs a pi restart.
- **Fail-open**: a missing key, authentication failure, timeout, network error, or malformed response lets the consultation run as configured; the failure is surfaced once per distinct outage.
- **Asymmetry**: a skip requires the hard conjunction of confident negligible stakes (`advisorJevFilterSkipConfidence`, default `0.85`) and confident self-answerability (`advisorJevFilterNoulMargin`, default `0.35`, added to a coin flip). Any uncertainty allows.
- **Overrides**: a skipped consultation never mentions the `force` parameter; it is discoverable only in the tool schema. The same question recurring within `advisorJevFilterOverrideWindow` (default `10` turns) passes automatically. Both force-after-skip and automatic passthroughs are counted in the Session Advisor Summary.
- **Repeats**: an exact repeat of an already-answered question is skipped without a Jev call and the earlier advice is reattached. Repeat reattachment is code-side and free — it also works with `advisorJevFilterEnabled` off (the flag gates only the Jev screening call); with no Jev activity in a session, the summary reports it under `Consultation dedup:` instead of the Jev filter line.
- **Costs**: `advisorJevModel` (default `jev-latest`), `advisorJevTimeoutMs` (default `8000`, the total wall budget incl. one retry), `advisorJevDigestMaxChars` (default `4000` conversation characters sent as evidence), and `advisorJevPricePerMtok` (default `0.042`) feed the summary's Jev spend line. A skipped call consumes no `advisorMaxCallsPerSession` budget.

## Proactive Jev turn gate

`advisorJevTurnGateEveryTurns` defaults to `0` (off). When set to N, every Nth completed turn **without a consultation** runs one Jev check over the conversation digest asking whether a senior advisor should weigh in right now. A confident yes (`advisorJevTurnGateNoulThreshold`, default `0.8`) runs a real Advisor consultation delivered to the Executor as a steer message between turns; any no, uncertainty, or failure keeps the status quo. Turn-gate consultations consume the shared `advisorMaxCallsPerSession` budget, appear in the Session Advisor Summary under trigger `turn-gate`, and coordinate with the loop gate: any consultation resets the without-consultation counter.

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
