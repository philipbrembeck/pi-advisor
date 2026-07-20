---
date: 2026-07-19T19:47:12.173932+00:00
git_commit: 78f281c03b4143e48e6ae006d914eb7b5e5cd4e
branch: main
topic: "Advisor consultation, gate, and reliability hardening"
tags: [plan, advisor, gates, budgets, herdr, configuration, testing]
status: draft
---

# PLAN: Advisor consultation, gate, and reliability hardening

Refactor pi-advisor so normal consultations are Markdown-only, automatic loop gates are strict machine-readable decisions, all Advisor invocations share clearly named budget accounting, and failures are configurable, observable, and safe. Preserve Executor behavior and existing persisted configuration compatibility.

## Acceptance Criteria

- [ ] Normal manual and Executor-requested consultations return and store raw Markdown unchanged.
- [ ] Normal consultations never call JSON parsing and never receive a synthetic verdict.
- [ ] Automatic gates accept only `proceed`, `revise`, or `blocked` decisions from the first non-empty line.
- [ ] Gate parsing accepts deliberate casing and surrounding whitespace, and rejects missing, malformed, duplicated, or contradictory decisions.
- [ ] Gate failures default to `block-session` and support `block-session`, `block-tool`, and `warn-and-continue`.
- [ ] Provider errors, empty responses, malformed gate responses, and exhausted budgets are explicit failure cases.
- [ ] Every Advisor invocation consumes the shared budget, with neutral API names and consistent used/remaining display.
- [ ] Executor behavior and Executor provider limits remain unchanged.
- [ ] Context truncation preserves complete semantic entries near the configured soft character limit and marks omitted older context.
- [ ] Oversized tool results use Pi’s built-in 2,000-line/50 KiB defaults unless overridden, preserve beginning and end sections, and mark omissions.
- [ ] Loop terminology accurately describes normalized matching; volatile per-tool fields are normalized deterministically where safe.
- [ ] Summaries distinguish Markdown consultations from automatic gate decisions and report trigger, model, usage/cost where available, budget, decision, and execution/blocking effect.
- [ ] Herdr integration can be disabled; when enabled, Advisor failures produce both local Pi feedback and Herdr `notification.show` requests, while activity/block metadata remains separate.
- [ ] Configuration validates unknown keys and invalid values at startup with actionable errors, while save operations preserve unknown fields.
- [ ] README, exported types, package compatibility tests, complete-flow tests, and CI checks describe and enforce the new contract.
- [ ] Every user-facing change, fix, configuration change, compatibility change, and behavioral correction is documented under exactly one `## 0.2.0` section in `CHANGELOG.md`; each phase updates that section as it is implemented.

## Technical Key Decisions and Tradeoffs

1. **Separate consultation and gate paths:** implement explicit `consultAdvisor()` and `runAdvisorGate()` functions rather than a `structuredMode` boolean.
   - Why: prevents normal advice from accidentally inheriting machine-decision behavior.
   - Impact: result types, prompts, rendering, recording, and error handling become explicit at call sites.

2. **Normal result contract:** use `AdvisorConsultationResult { markdown, model, trigger }` with no verdict field.
   - Why: free-form Markdown is the public behavior for normal advice.
   - Impact: remove `parseAdvice`, the legacy `Advice` schema, fallback verdicts, and normal-call blocking logic.

3. **Gate result contract:** use `AdvisorGateResult { decision, markdown, model, trigger }` with decisions limited to `proceed | revise | blocked`.
   - Why: only automatic gates need machine-readable control data.
   - Impact: gate explanation and decision render separately; parser failures become typed gate failures.

4. **Gate header parsing:** parse the first non-empty line case-insensitively with surrounding whitespace; reject subsequent decision lines and contradictions.
   - Why: tolerant of harmless formatting while preventing ambiguous machine control.
   - Impact: parser tests must cover duplicate and contradictory headers, not just valid values.

5. **Fail-safe policy:** default `gateFailureMode` to `block-session`; support `block-tool` and `warn-and-continue`.
   - Why: preserve the current safety posture while making policy explicit.
   - Impact: failure handling must never silently escalate block-tool to block-session.

6. **Shared Advisor budget:** rename internal state to `consumedCalls`, `remainingCalls`, `canConsult`, and `consumeCall`; retain `advisorMaxCallsPerSession` as the persisted compatibility key.
   - Why: manual, Executor-requested, and automatic calls all consume the same limit.
   - Impact: no misleading compatibility aliases; package tests protect the persisted key.

7. **Herdr behavior:** add an enabled-by-default `advisorHerdrIntegration` setting and send `notification.show` for Advisor failures, in addition to existing activity/block metadata.
   - Why: users need visible failure feedback in Herdr, but must be able to opt out.
   - Impact: sanitize/truncate notification text to Herdr limits; Herdr transport failures remain non-fatal and do not alter Advisor safety decisions.

8. **Semantic truncation:** treat `contextMaxChars` as a soft limit and retain the newest complete message/tool-result entries, adding an omission marker.
   - Why: never split JSON, Markdown, or tool results while preserving the user’s configured scale.
   - Impact: output may be slightly above/below the configured character target.

9. **Reuse Pi output limits:** use Pi’s exported `DEFAULT_MAX_LINES`, `DEFAULT_MAX_BYTES`, and truncation conventions as defaults, with Advisor-specific overrides.
   - Why: avoid conflicting defaults and preserve consistency with built-in tools.
   - Impact: large results need explicit beginning/end markers and configuration tests.

10. **Configuration compatibility:** reject unknown/invalid configuration at load with actionable errors, but preserve unknown fields when saving.
    - Why: catch mistakes without destroying fields owned by newer versions or other tools.
    - Impact: configuration load errors must be surfaced rather than silently ignored.

## Current State

```text
manual command ───────┐
Executor ask_advisor ─┼─> consult(..., structuredMode=false)
loop gate ────────────┘       ├─ normal: parseAdvice(JSON)
                              └─ gate: parseAutomaticDecision()

all calls -> automaticCalls budget
all consultations -> optional verdict + summary aggregation
context -> joined entries -> slice(-maxChars)
Herdr -> activity/block metadata only
```

Relevant implementation surfaces:

- `src/tools.ts`: consultation stream, parsers, custom tool, automatic loop gate, rendering, and blocking.
- `src/commands.ts`: manual consultation command, settings UI integration, and local notifications.
- `src/session-state.ts`: loop signatures, budget, consultation records, and summaries.
- `src/config.ts`: defaults, persisted config validation/loading/saving.
- `src/conversation.ts`: reconstructed context formatting and truncation.
- `src/ui.ts`: Advisor settings rows and keyboard navigation.
- `src/herdr.ts`: optional Unix-socket metadata reporting.
- `test/*.test.ts`: existing registration, config, conversation, and session-state coverage; no focused tools-flow suite currently exists.

## Desired End State

```text
manual command ───────> consultAdvisor() ──> AdvisorConsultationResult
Executor ask_advisor ─> consultAdvisor() ──> raw Markdown, no verdict
loop gate ────────────> runAdvisorGate() ──> AdvisorGateResult
                                      ├─ strict Decision parser
                                      └─ explicit failure policy

all Advisor paths -> consumedCalls budget -> used/remaining metrics
all failures -> local Pi notification + optional Herdr notification.show
context -> complete semantic entries + omission marker
```

## Abstractions and Code Reuse

- Reuse the existing `stream()` collection and `onChunk` callback, but put them behind explicit consultation/gate functions.
- Reuse `advisorForDisplay`, existing call boxes, Markdown renderers, and streaming UI surfaces; add only the distinct gate decision presentation needed by automatic reviews.
- Reuse Pi’s `truncateHead`/`truncateTail` utilities and constants from `@earendil-works/pi-coding-agent` where the installed public API permits it.
- Add small pure helpers for gate parsing, semantic entry selection, tool-result capping, per-tool argument normalization, Herdr notification request construction, and configuration validation.
- Keep session summaries in memory only; do not send summary data to Herdr or persist it.

## Logging & Observability

Record each consultation locally with:

- consultation/gate kind;
- trigger: `manual`, `executor-requested`, `repeated-tool-call`, `completion-review`, or `custom-rule`;
- Advisor model;
- token usage and estimated cost when provider data exposes them;
- gate decision when applicable;
- whether execution continued, the tool was blocked, or the session was blocked;
- failure category and user-facing reason.

Summaries should use distinct sections, for example:

```text
[Session Advisor Summary]
Consultations: 3 (manual 1, executor-requested 1, automatic gates 1)
Triggers: manual, executor-requested, repeated-tool-call
Models: provider/model
Budget: 3 / 5 used; 2 remaining
Markdown advice: 2 responses
Gate decisions: 1 revise
Execution effects: 1 tool blocked, 0 sessions blocked
Failures: none
```

Herdr failure notifications should use `notification.show` with sanitized title/body, while activity and blocked-state metadata continue using separate sources. The `advisorHerdrIntegration` setting gates all three Herdr paths.

## Implementation

### Phase 1: Split Markdown consultations from automatic gates

Dependencies: None.

Deliver the highest-priority behavior change without changing Executor semantics.

**Tasks**:

- [x] Update `CHANGELOG.md` under `## 0.2.0` for every Phase 1 user-facing behavior, fix, type, and compatibility change delivered.
- [x] Define exported `ConsultationTrigger`, `GateTrigger`, `AdvisorConsultationResult`, `AdvisorGateResult`, and gate failure/result types in the appropriate public source module.
- [x] Replace `Advice`/`AdvisorVerdict` normal-call usage with the separate result contracts; retain decision literals only for gate results.
- [x] Delete `parseAdvice()` and its legacy JSON shape when repository-wide references are removed.
- [x] Rewrite `parseAutomaticDecision()` to parse the first non-empty line, accept surrounding whitespace/casing, allow only `proceed`, `revise`, and `blocked`, and reject duplicate/contradictory decision lines.
- [x] Make parser failures typed and fail-safe without fabricating normal consultation verdicts.
- [x] Replace `consult(..., structuredMode)` with explicit `consultAdvisor(...)` and `runAdvisorGate(...)` paths sharing only low-level stream/model plumbing.
- [x] Ensure normal results preserve final Markdown exactly, while streaming partial text remains display-only and cannot replace final output.
- [x] Remove normal Executor-call blocking based on parsed verdicts; keep blocking decisions exclusive to automatic gates.
- [x] Render automatic gate decisions distinctly from their Markdown explanation without exposing parser internals to the Executor.
- [x] Add regression tests for unchanged Markdown, no JSON parsing, no synthetic verdict, streaming/final-output behavior, and all strict gate parsing cases.

**Automated Verification**:

- [x] Add focused `tools` tests proving `JSON.parse`/legacy parsing is not on the normal path.
- [x] Test valid gate headers (`proceed`, `revise`, `blocked`) with casing and whitespace.
- [x] Test missing, malformed, duplicated, and contradictory decisions and assert the fail-safe error classification.
- [x] Run `bun test` and `bun run typecheck`.

**Manual Verification**:

- [x] Reload the TUI and compare normal call box, streaming state, Markdown response, error state, and automatic gate rendering against the existing Advisor UI.

### Phase 2: Shared budget and configurable gate failures

Dependencies: Phase 1.

Make policy and accounting explicit for every Advisor invocation.

**Tasks**:

- [x] Update `CHANGELOG.md` under `## 0.2.0` for every Phase 2 budget, failure-policy, Herdr, configuration, and UI change delivered.
- [x] Rename session-state fields and methods to neutral shared-budget terminology and remove automatic-only aliases.
- [x] Route manual, Executor-requested, and automatic calls through `canConsult()`/`consumeCall()` consistently, including concurrent manual consultation cancellation behavior.
- [x] Add `gateFailureMode` with default `block-session` and validation for `block-session`, `block-tool`, and `warn-and-continue`.
- [x] Add `advisorHerdrIntegration` with default `true`, load/save support, settings UI navigation, and persisted compatibility tests.
- [x] Centralize gate failure handling for provider errors, empty responses, malformed/duplicate decisions, and exhausted budgets without changing Executor behavior.
- [x] Ensure `block-tool` only blocks the current tool action and does not silently call `ctx.abort()` or mark the session blocked.
- [x] Ensure `warn-and-continue` reports the failure but permits the affected action/session to continue.
- [x] Surface all failure modes locally through appropriate Pi notifications and preserve Herdr state updates.
- [x] Add `notification.show` request construction and transport through `HERDR_SOCKET_PATH`, including sanitized/truncated title/body, `top-left` position, and request sound.
- [x] Make Herdr notification, activity, and blocked metadata conditional on the integration setting; keep Herdr transport errors non-fatal.
- [x] Update session summary budget text to show total Advisor calls used and remaining, not automatic-only counts.
- [x] Add tests for defaults, validation, persistence, UI navigation, all failure modes, budget exhaustion, Herdr opt-out, Herdr request payloads, and Herdr transport failures.

**Automated Verification**:

- [x] Run config/session-state/Herdr tests covering defaults, persistence, neutral names, failure policy, and opt-out.
- [x] Test manual, Executor, and automatic calls consume one shared finite budget.
- [x] Test provider timeout/error, empty response, invalid gate, and exhaustion under each failure mode.
- [x] Run `bun test` and `bun run typecheck`.

**Manual Verification**:

- [x] In a Herdr-managed pane, trigger an Advisor provider failure and verify both the Pi error toast and Herdr toast appear when enabled.
- [x] Disable Advisor Herdr integration, repeat the failure, and verify local Pi feedback remains while Herdr receives no Advisor request.

### Phase 3: Semantic context and tool-result limits

Dependencies: Phase 1; Phase 2 for configuration plumbing.

Prevent malformed or misleading Advisor context while preserving existing user-configured scale.

**Tasks**:

- [x] Update `CHANGELOG.md` under `## 0.2.0` for every Phase 3 truncation, tool-result, and configuration change delivered.
- [x] Refactor `recentConversation()` to represent complete semantic entries before applying the soft `contextMaxChars` budget.
- [x] Preserve the newest complete message/tool-call/tool-result boundaries and add an explicit older-context omission marker when entries are dropped.
- [x] Ensure zero context still produces no history and the ALL sentinel still preserves the complete branch subject to provider limits.
- [x] Add configurable Advisor tool-result line/byte limits using Pi’s defaults (`2000` lines, `50 KiB`) when no override is configured.
- [x] Cap large tool results by preserving beginning and end sections with a clear omitted-section marker; never split JSON/Markdown/tool-result structure unnecessarily.
- [x] Include truncation metadata in local metrics where available without sending raw omitted content to Herdr.
- [x] Add configuration defaults, validation, persistence, settings UI, and documentation for the new tool-result limits.
- [x] Add boundary tests for entries just below/above the context limit, oversized single entries, tool calls/results, Unicode, omission markers, and preserved head/tail output.

**Automated Verification**:

- [x] Run conversation and truncation tests proving no output starts mid-entry or mid-tool result.
- [x] Verify soft-limit output can be slightly under/over the configured character target while remaining semantically complete.
- [x] Run `bun test` and `bun run typecheck`.

### Phase 4: Loop normalization and structured observability

Dependencies: Phases 1–3.

Make repeated-call behavior explainable and summaries useful without persisting sensitive session context.

**Tasks**:

- [x] Update `CHANGELOG.md` under `## 0.2.0` for every Phase 4 normalization, observability, and summary change delivered.
- [x] Replace generic stable-JSON loop terminology with explicit normalized-signature terminology in code, prompts, summaries, and README.
- [x] Add deterministic per-tool normalizers for volatile timestamps, request IDs, temporary paths, and safe shell whitespace/argument normalization.
- [x] Keep normalization allowlisted and explainable; retain raw tool name and a safe diagnostic reason without logging secrets or full sensitive arguments.
- [x] Add trigger recording at every invocation site, including manual, Executor-requested, repeated-tool-call, completion-review, and custom-rule paths.
- [x] Record model, usage/cost where exposed by the stream result, gate decision, failure type, and execution effect.
- [x] Redesign summaries to separate Markdown advice entries from automatic gate entries and report trigger types and budget consistently.
- [x] Keep summaries local and ephemeral and exclude them from Herdr requests and persisted session state.
- [x] Add session-state and integration tests for normalization determinism, volatile-field removal, trigger/metric recording, and summary output.

**Automated Verification**:

- [x] Test equivalent normalized tool calls trigger the threshold and materially different calls do not.
- [x] Test volatile fields do not cause false differences while unsafe argument reordering is not normalized.
- [x] Assert summaries distinguish advisory Markdown from gate decisions and include execution effects.
- [x] Run `bun test` and `bun run typecheck`.

### Phase 5: Contract, documentation, complete flows, and release checks

Dependencies: Phases 1–4.

Make the behavior stable and releasable across the public package surface.

**Tasks**:

- [-] Update README configuration examples and behavior text: normal Markdown consultations, gate-only decisions, shared budget, failure modes, Herdr opt-out/notifications, truncation, normalization, and summary semantics.
- [ ] Reconcile `CHANGELOG.md` so exactly one `## 0.2.0` section documents every change, fix, configuration change, compatibility change, and behavioral correction delivered by all phases; remove claims that every Advisor response has a structured verdict.
- [ ] Add a canonical configuration contract/type export and startup errors identifying the file, key, accepted values, and remediation.
- [ ] Preserve unknown persisted configuration fields and add package-level compatibility tests for command names, configuration keys, persisted state, and exported result types.
- [ ] Add complete-flow tests for manual consultation, Executor-triggered consultation, repeated-call gate, timeout, invalid gate, budget exhaustion, session restore, streaming, and differing Executor/Advisor providers.
- [ ] Add cross-provider warnings and redaction tests for data that may leave the Executor provider, without altering Executor behavior.
- [ ] Add strict unused-code/lint/format checks and package-content inspection.
- [ ] Extend CI with typecheck, unit/integration tests, formatting, linting, dependency audit, package inspection, and provenance-enabled publishing checks.
- [ ] Verify the final package includes only intended public files and that the publish workflow remains compatible with npm and GitHub Packages.

**Automated Verification**:

- [x] Run `bun test`.
- [x] Run `bun run typecheck`.
- [x] Run formatting and lint checks configured for the repository.
- [x] Run dependency audit and package-content inspection in CI.
- [ ] Assert exactly one `## 0.2.0` heading exists and verify all delivered user-facing, configuration, compatibility, and behavioral changes are represented in that section.
- [x] Run `git -c diff.stat=false diff --no-ext-diff --check --no-stat`.
- [ ] Execute the full integration-flow matrix with mocked providers and Herdr socket responses.

**Manual Verification**:

- [x] Reload the TUI and verify normal consultation call/stream/response/error rendering.
- [x] Verify automatic gate decision and explanation are visibly distinct.
- [x] Verify block-session, block-tool, and warn-and-continue behavior in a live repeated-call flow.
- [x] Verify session restore does not resurrect stale in-memory budget, Herdr activity, or summary state.
- [x] Verify Executor and Advisor can use different providers without changing Executor behavior.

## Implementation Notes

During implementation, record user feedback, discovered Pi/Herdr API constraints, migration decisions, and any changes to the failure or redaction policy here.

- 2026-07-20: Added an Ultracite formatter-only command. Strict linting is intentionally deferred to a later iteration and is not part of CI.

## References

- `src/tools.ts`
- `src/session-state.ts`
- `src/config.ts`
- `src/commands.ts`
- `src/conversation.ts`
- `src/ui.ts`
- `src/herdr.ts`
- `test/config.test.ts`
- `test/conversation.test.ts`
- `test/registration.test.ts`
- `test/session-state.test.ts`
- `CHANGELOG.md` (exactly one `## 0.2.0` release section is mandatory)
- `docs/agents/research/2026-07-18-herdr-agent-states.md`
- Pi extension API: `/Users/philipbrembeck/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Herdr Socket API: https://herdr.dev/docs/socket-api/
