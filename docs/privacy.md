# Privacy and data handling

Advisor context can contain user messages, tool calls, tool results, and repository information. Configure disclosure deliberately.

Redaction and output limits reduce accidental disclosure; they are not a data-classification system and cannot guarantee every secret is found. Use tool policies for content that must not be sent to the Advisor.

## Repository context

- `advisorGitContext` defaults to `summary` and controls how much of the working tree reaches the Advisor:
  - `off` sends no repository information.
  - `summary` sends changed file names, change status, and line counts. It never sends file contents.
  - `full` additionally sends the patch.
- Changes are measured against the last commit and cover staged and unstaged work. Untracked files are always listed by name only; `gitContext: full` never sends their contents.
- `advisorTrackedFileContent` defaults to `false`. When enabled, `includeTrackedFiles` can attach only exact named, repository-relative, tracked regular files from the current working tree. This is intended for a discretionary sequential follow-up when the Advisor explicitly names a missing file; sibling files remain withheld.
- `advisorUntrackedContent` defaults to `false`. When enabled, `includeUntracked` can attach only exact named, repository-relative, untracked regular files. Files are redacted and capped before egress; sibling files remain withheld.
- Tracked and untracked text attachments share the 8 KiB per-file and 24 KiB aggregate limits. Binary non-image files, symlinks, directories, submodules, traversal paths, and files outside the repository are refused. Current tracked bodies may include unstaged edits.
- For an image-capable Advisor, selected user messages and full-policy tool results may forward PNG, JPEG, GIF, or WebP pixels (not just their descriptions). Tool `summary` and `exclude` policies withhold result images; conversation and Scout selection limits also apply. Scout sees bounded image markers, never the pixels. Text-only models receive an explicit no-pixels notice.
- Explicit `includeTrackedFiles` and `includeUntracked` paths with supported image extensions can forward image files under the same tracked one-shot handoff and global file-content consent rules. Images have a separate cap of 4 MiB each, four images and 8 MiB total across history and files. Mismatched MIME/format, unsupported formats (including SVG), invalid data and oversized images are withheld. When pixels are unavailable, the Advisor is told not to claim visual review.
- Credential redaction cannot inspect or scrub pixels. Do not attach screenshots containing sensitive data unless you intend the Advisor provider to receive it.
- `advisorGitContextMaxChars` defaults to `20000`. Repository context may claim its own cap or half of `contextMaxChars`, whichever is smaller, so it cannot crowd out the conversation.
- The Executor may pass `gitContext` to `ask_advisor` as `none`, `summary`, or `full`. `advisorGitContext` is the ceiling. A larger request is narrowed to the configured level, and the Advisor is told that a fuller view was withheld.
- `summary` deliberately excludes diff hunk headers. Git derives those from surrounding file content, so a hunk header can reproduce a line the change never touched, including a credential.
- Redaction runs before the region is capped. Repository content is labelled as untrusted data, and paths and patch text are escaped so a crafted path cannot close the region early and have the remainder read as instructions.
- File names can be sensitive. `summary` withholds file contents, not file names; use `off` when names must not leave the machine.
- Collection shares a single overall time budget across its Git commands and degrades to a stated failure rather than implying a clean tree.

## Secret redaction and tool policies

- `advisorRedactSecrets` defaults to `false`. When enabled, pi-advisor locally redacts common credential patterns before including context or targeted questions in an Advisor request. The raw targeted question remains available to local UI displays but is not sent to the provider.
- `advisorToolPolicies` matches an **exact tool name**. Each tool may use `full`, `summary`, or `exclude`:
  - `full` includes call arguments and capped result output.
  - `summary` omits call arguments and result output but includes result status and size metadata.
  - `exclude` omits both call details and output.
- Tools not listed in `advisorToolPolicies`, including custom and newly added tools, use `full` for backward compatibility.

## Codemode disclosure

Pi Codemode calls the same registered `ask_advisor` tool, with the same screening, context reconstruction, redaction, repository ceilings, and attachment consent. Nested tool results are not stored as transcript entries; pi-advisor does not retrieve them from Codemode's local variables or nested-call metadata.

The existing `draft` can carry a concise, permitted summary of collected results. It is optionally redacted, capped at 8 KiB, and labelled as an unverified Executor claim, not independent evidence. It also reaches Jev when screening is enabled. Draft and question text are explicit disclosure and are not filtered by the source tools' `advisorToolPolicies`. Do not use them to copy excluded output, secrets, or file bodies withheld by repository or attachment settings. Prefer `gitContext` for patches so the configured ceiling remains effective.

Historical Codemode calls and their emitted results are governed by the exact `codemode` tool policy, not by policies for tools called inside the script. Set `advisorToolPolicies.codemode` to `summary` or `exclude` when scripts or their output must be withheld from reconstructed history.

## Fallback and follow-up egress

`advisorFallbackModel` receives the same prepared, redacted request as the primary model after a retryable primary resolution or provider failure. No fallback request is sent when the operation is cancelled, the fallback matches the active Executor, or request preparation fails. If both models fail, the local error includes both attempts without persisting either payload.

`followUpTo` reuses the exact post-redaction message payload held in memory for the prior `adviceId` and appends the new question after applying the current-or-stricter redaction policy. The cache is never written to the session or filesystem. It expires after five minutes, is cleared by a new user input or three later non-Advisor tool results, and is capped at three follow-up levels. Reuse is bound to the original project directory and trust state. Changing any tracked disclosure, tool-policy, context-cap, or redaction setting invalidates that cache instead of sending the old prefix under different privacy rules. Use a fresh consultation when new files, Git context, or other context must be disclosed.

## Project rules and preferences

`advisorAgentsMdContext` defaults to `true`. In a trusted project, the project-root `AGENTS.md` and global `~/.pi/agent/AGENTS.md` may be sent with each Advisor call. The files are read through the same trusted-reader protections as project preferences: no symlinks, realpath containment, redaction, an 8 KiB per-source cap, and a combined 16 KiB rules cap. They are origin-labelled inside a separate `<project_rules>` block and framed as untrusted review guidance, not executable instructions.

An untrusted project withholds both files and tells the Advisor that rules were withheld. The global file is never sent for an untrusted project. Disable `advisorAgentsMdContext` to prevent either file from being read or sent.

In a trusted project, `.pi/advisor-preferences.md` may provide a short local brief. It is never written by pi-advisor, remains separate from `AGENTS.md`, is treated as lower-priority untrusted text, and is redacted and capped before egress. Symlinks, unreadable files, and paths outside the project are ignored. The explicit preferences brief is more specific than general `AGENTS.md` conventions, but neither source overrides the Advisor system instructions.

## Experimental Advisor Scout

`advisorScoutEnabled` defaults to `false`. When enabled, Scout sends a bounded manifest of Advisor-eligible conversation and tool history to the configured Executor model and provider before every Advisor invocation.

The same tool disclosure policies, tool-result limits, and optional secret redaction run before Scout sees historical content. Image content is represented by non-pixel markers for selection; image bytes never reach Scout. Advisor image pixels are bound to selected evidence groups, not to markers repeated in Scout's synthesis. Tool-call and result messages are grouped atomically. Incomplete historical fragments are omitted rather than sent as orphan evidence. Required current-request context cannot be partially truncated to force a Scout call.

Scout does not receive the deterministic Git context, Executor draft, project preferences, or explicitly attached tracked and untracked files. These regions bypass Scout and retain their existing disclosure, redaction, escaping, and cap rules when the final Advisor request is assembled.

Scout returns selected opaque group IDs and a bounded synthesis. The Advisor receives the selected verbatim groups plus a label that identifies the synthesis as untrusted, non-authoritative inference. Scout free-form text never replaces the evidence.

The Scout call creates separate provider usage and cost. Its metrics are local and ephemeral. pi-advisor does not persist a Scout trajectory, add Scout data to Session Advisor Summary, send it to Herdr, or charge it against the Advisor-call budget. An ordinary Scout failure uses the original conversation; parent cancellation stops the complete operation.

## Outcome logging

`advisorOutcomeLogging` defaults to `false` and is global-only: a project config cannot enable it.

`/advisor-stats` reads the local ledger only. It reports counts and rates from retained records, including the first and last timestamps and distinct pseudonymous advice hashes; it does not reconstruct advice or fabricate historical usage/cost. The ledger is capped at 1 MiB and rewritten on overflow, so the report covers only the retained window. Truncated or malformed lines are ignored.

When enabled, `~/.pi/agent/advisor-outcomes.jsonl` stores bounded, rotating JSONL records containing only a version, timestamp, salted truncated advice digest, trigger, adoption, and validation status. It stores no prompt, advice, paths, tool output, repository data, session ID, or advice ID.

## Jev/Decisions screening and the turn gate

The optional consultation filter (`advisorJevFilterEnabled`) and proactive turn gate (`advisorJevTurnGateEveryTurns`) are off by default. `/advisor-settings` → **Jev provider** offers TypeSafe Jev, OpenRouter using the existing Pi login, OpenAI Decisions, or a user-supplied System One–compatible endpoint. Every one is live-verified before it is saved. `advisorJevTransport` remains `auto` by default and preserves its TypeSafe-key → OpenRouter order; OpenAI Decisions and the custom endpoint are opt-in and are never selected automatically.

Every provider receives the same bounded Jev evidence: a `role` marker, the Executor's `question` and `draft` (each redacted and capped at 8 KiB when present), and a `recent_conversation` digest capped by `advisorJevDigestMaxChars` (default 4,000 characters). The digest uses the Advisor context pipeline, so tool disclosure policies, tool-result caps, and optional secret redaction apply, and older entries are dropped first. The proactive turn gate sends the digest alone. No Git context, file attachments, images, Scout output, or project preferences are sent to Jev/Decisions.

TypeSafe and OpenRouter retain their existing named-question request. OpenAI Decisions serializes only this Jev state as text input and sends named predicate/score questions to `https://api.openai.com/v1/decisions`, using the fixed beta model `gpt-6-luna`. A System One–compatible endpoint receives the same request shape as TypeSafe, sent to the Base URL you configured with `/v1/systemone` appended. TypeSafe requests go to `api.typesafe.ai`; OpenRouter requests go to `openrouter.ai`. Only the selected provider receives screening evidence: `auto` never selects OpenAI or a custom endpoint, and explicit provider selection is live-verified before it is saved. pi-advisor composes the skip decision locally: both negligible stakes and self-answerability must pass their existing thresholds (`advisorJevFilterSkipConfidence` 0.85 and `advisorJevFilterNoulMargin` 0.35 by default). Those thresholds have not been empirically calibrated for Decisions, or for third-party implementations of the contract. Missing, refused, malformed, or uncertain answers and provider errors allow the consultation (fail-open). Nothing about screening activity is sent to Herdr; turn-gate _consultations_ are ordinary Advisor egress.

Choosing a custom endpoint is the one case where the destination host is not a vendor pi-advisor can vouch for: it is whatever URL you entered. Plain `http` is accepted only for `localhost`, `::1`, and `127.x` addresses so local decision-model servers work; other hosts require `https`. The destination is never inferred, never selected by `auto`, and never saved unless a live Jev call succeeded against it.

OpenAI Decisions requires an OpenAI Platform API key and API billing; a ChatGPT subscription does not provide that API key. Pi's `openai` provider is reused only when its auth source is `OPENAI_API_KEY` or a stored API-key credential. OAuth—including subscription OAuth from Pi's `openai` and `openai-codex` providers—and unknown auth sources are rejected. If no Platform key resolves, guided setup accepts a masked key and stores it in Bun.secrets or `openai_api_key` under the configured Pi agent directory with mode `0600`. It is never written to `advisor.json`. TypeSafe keys remain separate; TypeSafe keys entered during setup use Bun.secrets or the dedicated `typesafe_api_key` file, and a hand-placed `typesafe_api_key` value can still be migrated from `advisor.json`.

OpenAI states that API data is not used to train models by default. Its [data-controls documentation](https://developers.openai.com/api/docs/guides/your-data) lists `/v1/decisions` as having no application-state retention and up to 30 days of abuse-monitoring-log retention by default. Eligible organizations may request Zero Data Retention, subject to approval and endpoint limitations; do not assume it is enabled for your project. Prompt caching may retain encrypted key/value tensors on local GPU machines for up to 24 hours. These policies are OpenAI's, not pi-advisor guarantees.

Jev/Decisions token usage is accounted locally and never inflates consultation counters. TypeSafe/OpenRouter/System One–compatible costs remain estimates controlled by `advisorJevPricePerMtok`; OpenAI Decisions cost is shown as unavailable while endpoint-specific cached/output/region billing remains unresolved. The key is passed only to the selected provider endpoint, never logged or included in errors. A custom endpoint's key is stored in Bun.secrets or a `0600` file, or supplied by `JEV_API_KEY` or a reused Pi provider login; it is never written to `advisor.json`. The free-form Advisor request/response and its existing rendering are unchanged.

## Session summary and Herdr

The optional Session Advisor Summary defaults to off. When enabled, it is local and in-memory only, appears after a non-blocked settled run, and is never persisted.

It distinguishes regular Markdown advice from gate decisions and records the trigger, model, usage and cost when available, failures, budget, and execution effect.

[Herdr](https://github.com/ogulcancelik/herdr) integration is enabled by default. It reports Advisor activity and a bounded, redacted blocked-state summary through Herdr's metadata paths. Disable it with `advisorHerdrIntegration`. Previously reported state is still cleared when integration is disabled.

See [Configuration](configuration.md) for all settings and defaults.
