# Configuration

Use `/advisor-models` and `/advisor-settings` to configure pi-advisor. Both commands save to the global `advisor.json` in the Pi agent directory. `/advisor-settings` uses Pi's compact searchable settings list: type to fuzzy-search a control, press Enter or Space to change it, and every valid change is saved immediately.

Repository-controlled project `advisor.json` files are not applied. Models, prompts, gates, budgets, disclosure, redaction, integrations, and consent remain under the user's global configuration.

`/advisor` also accepts `executor=`, `advisor=`, and `contextMaxChars=` overrides for the current activation. For example, `/advisor contextMaxChars=30000` sets the reconstructed-history limit; use `0` for no history. The `ALL` option in settings represents the complete current branch and remains subject to the Advisor model's context limit. On first use, or when either saved model ref is missing from the configuration or Pi's available model list, `/advisor` opens the available-model picker instead of silently choosing an unconfigured model. The selected Executor and Advisor refs are persisted only after both models pass activation checks.

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

- `simpleMode` defaults to `false`. When enabled, `ask_advisor` and `/advisor-manual` remain available for voluntary second opinions, while plan/failure/completion rules, loop gates, blocking, call budgets, and session summaries are disabled. Context limits, result caps, redaction, and tool disclosure policies still apply.
- `alwaysOn` defaults to `false`. When enabled, Pi restores the configured Executor and activates `ask_advisor` for new, resumed, forked, and reloaded sessions. If model refs are missing or unavailable, startup reports the problem without activating; run `/advisor` to choose available models interactively. A native subagent launcher that sets `PI_SUBAGENT_CHILD=1` keeps its host-selected model and thinking level; Advisor tools still activate, but the child is not switched to the parent Executor.
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

## AGENTS.md and Advisor preferences

`advisorAgentsMdContext` defaults to `true`. In a trusted project, each Advisor call may include the project-root `AGENTS.md` and the global `~/.pi/agent/AGENTS.md` when present. Each source is origin-labelled, redacted when `advisorRedactSecrets` is enabled, capped at 8 KiB, and included in a combined 16 KiB rules budget. The Advisor receives them in a separate untrusted `<project_rules>` block as review guidance, never as executable instructions.

An untrusted project sends neither rules file; the Advisor is told that rules were withheld rather than being shown an apparently rule-free project. The global rules file is never sent for an untrusted project. Turn the setting off to restore the previous behavior.

`.pi/advisor-preferences.md` remains separate: it is an explicit, Advisor-specific project brief, while `AGENTS.md` supplies general project/global conventions. Both are untrusted context, and neither can override the Advisor system instructions; the explicit preferences brief is more specific when the two sources conflict.

## Consultation responses

Normal consultations preserve the provider's final Markdown and never block execution. If the Advisor explicitly says it cannot review a specifically named file, the Executor may make a sequential follow-up call with `includeTrackedFiles` when global tracked-file consent is enabled; this is discretionary, not an automatic retry. When the Advisor has no material concern or recommendation, it may begin with the exact first line `Verdict: sound`. Pi renders that response with the static `◆ ADVISOR · SOUND` header for both `ask_advisor` results and `/advisor-manual`.

## Jev/Decisions consultation filter

`advisorJevFilterEnabled` defaults to `false`. When enabled, one typed screening request checks each `ask_advisor` invocation. Only requests classified as both negligible-stakes and self-answerable are skipped; all others reach the Advisor unchanged.

The filter and the provider are separate rows. **Jev provider** chooses and verifies the provider; the **Jev/Decisions consultation filter** row only switches screening on and off. Enabling the filter requires that the selected transport currently resolves credentials; if it does not, the row explains why and stays off rather than silently screening nothing. Because a provider is always live-verified before it is saved, an enabled filter has a provider that worked at least once; a key that stops working later fails open at runtime.

- **Provider selection**: `/advisor-settings` → **Jev provider** selects the provider used by screening and the turn gate. Choose TypeSafe Jev, OpenRouter, OpenAI Decisions, or **System One–compatible endpoint**. Every provider is live-verified before it is saved.
- **`auto` compatibility**: `advisorJevTransport` remains `auto` by default. It keeps the existing TypeSafe-key → OpenRouter-login order. `typesafe`, `openrouter`, and `typesafe-compatible` continue to force those providers; `typesafe-compatible` and `openai-decisions` are never chosen by `auto`.
- **System One–compatible endpoints**: `advisorJevBaseUrl` names the root of a deployment that speaks TypeSafe's System One contract — a corporate gateway, a third-party compatible host, or a decision model on `localhost`. The accepted spellings are the origin, the origin plus `/v1`, or a full `/v1/systemone` URL; all are normalized to the origin, and `/v1/systemone` is appended at request time. A path prefix is preserved, so `https://gw.corp/llm/jev` requests `https://gw.corp/llm/jev/v1/systemone`. **A trailing `/v1` is treated as the contract's own version segment and removed**, which is why `https://api.typesafe.ai/v1` and `https://api.typesafe.ai` address the same endpoint; a gateway whose prefix genuinely ends in `/v1` is the one case this cannot express. `https` is required except on `localhost`, `::1`, and `127.x` addresses, where plain `http` is allowed for local servers. Query strings, fragments, and embedded credentials are rejected.
- **Endpoint credentials**: `advisorJevKeyProvider` optionally names a Pi provider whose stored login supplies the key. When it is set it wins outright: if that login is missing or empty the endpoint resolves no credentials and screening fails open with a notice, rather than quietly falling back to a stored key that may belong to a different host. Entering a key in guided setup clears the field. Otherwise the key resolves from Bun.secrets, then the `JEV_API_KEY` environment variable, then a `0600` file in the Pi agent directory. It is never written to `advisor.json`.
- **OpenAI Decisions**: uses the fixed public-beta model `gpt-6-luna` at `https://api.openai.com/v1/decisions`; the TypeSafe `advisorJevModel` setting does not select this model. It requires an OpenAI Platform API key and separate API billing. ChatGPT subscription OAuth from Pi's `openai` or `openai-codex` providers is not accepted as an API key. Pi's `openai` provider is reused only when its auth source is the `OPENAI_API_KEY` environment variable or a stored API-key credential. Otherwise, guided setup accepts a masked Platform key.
- **When to use a custom endpoint**: choose it when you need Jev traffic behind your own gateway, when you want a locally hosted decision model, or when your provider serves Jev under its own host. `advisorJevModel` stays a shared free-text field for every System One–shaped provider; `jev-latest` is accepted as an alias by several compatible implementations.
- **Key storage**: entered OpenAI keys are stored in Bun.secrets when available, otherwise in `openai_api_key` under the configured Pi agent directory with mode `0600`. They are never written to `advisor.json` and remain separate from TypeSafe keys and Pi-managed credentials. Disable-and-clear removes only the selected provider's extension-owned key; it never deletes environment variables or Pi logins.
- **Evidence and thresholds**: the OpenAI request formats only the existing bounded Jev state as text and sends named predicate/score questions. It adds no Git context, file attachments, images, or Scout output. The existing thresholds (`advisorJevFilterSkipConfidence` 0.85 and `advisorJevFilterNoulMargin` 0.35 by default) remain in effect, but have not been empirically calibrated for Decisions. Any missing, refused, malformed, or uncertain answer allows the Advisor consultation.
- **Fail-open and repeats**: a missing key, authentication failure, timeout, network error, or malformed response lets the consultation run; the outage is surfaced once per distinct failure. Exact repeats are still handled locally and free, even when filtering is off. `advisorJevFilterOverrideWindow` defaults to 10 turns; force-after-skip and automatic passthroughs are counted in the Session Advisor Summary. Skipped calls do not consume `advisorMaxCallsPerSession`.
- **Usage and cost**: `advisorJevTimeoutMs` (8000 ms by default, including one retry) and `advisorJevDigestMaxChars` (4000 by default) apply across providers. TypeSafe/OpenRouter/System One–compatible cost remains an estimate controlled by `advisorJevPricePerMtok` (default 0.042). Decisions token usage is recorded, but its cost is shown as unavailable; the extension does not apply that TypeSafe price or treat an unknown charge as zero. The [Decisions guide](https://developers.openai.com/api/docs/guides/decisions) and [general pricing page](https://developers.openai.com/api/docs/pricing) differ on `gpt-6-luna` cached/output billing, so the extension waits for endpoint-specific billing confirmation. A skip consumes no Advisor-call budget.

## Proactive Jev/Decisions turn gate

`advisorJevTurnGateEveryTurns` defaults to `0` (off). When set to N, every Nth completed turn **without a consultation** asks the selected Jev/Decisions provider whether a senior advisor should weigh in now. A confident yes (`advisorJevTurnGateNoulThreshold`, default `0.8`) runs a real Advisor consultation delivered as a steer message between turns; a no, uncertainty, or provider failure keeps the status quo. Turn-gate consultations consume the shared `advisorMaxCallsPerSession` budget, appear in the Session Advisor Summary under trigger `turn-gate`, and reset the without-consultation counter.

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
