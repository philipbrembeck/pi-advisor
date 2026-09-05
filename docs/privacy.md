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
- Tracked and untracked attachments share the 8 KiB per-file and 24 KiB aggregate limits. Binary files, symlinks, directories, submodules, traversal paths, and files outside the repository are refused. Current tracked bodies may include unstaged edits.
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

## Project preferences

In a trusted project, `.pi/advisor-preferences.md` may provide a short local brief. It is never written by pi-advisor, is treated as lower-priority untrusted text, and is redacted and capped before egress. Symlinks, unreadable files, and paths outside the project are ignored.

## Experimental Advisor Scout

`advisorScoutEnabled` defaults to `false`. When enabled, Scout sends a bounded manifest of Advisor-eligible conversation and tool history to the configured Executor model and provider before every Advisor invocation.

The same tool disclosure policies, tool-result limits, and optional secret redaction run before Scout sees historical content. Tool-call and result messages are grouped atomically. Incomplete historical fragments are omitted rather than sent as orphan evidence. Required current-request context cannot be partially truncated to force a Scout call.

Scout does not receive the deterministic Git context, Executor draft, project preferences, or explicitly attached tracked and untracked files. These regions bypass Scout and retain their existing disclosure, redaction, escaping, and cap rules when the final Advisor request is assembled.

Scout returns selected opaque group IDs and a bounded synthesis. The Advisor receives the selected verbatim groups plus a label that identifies the synthesis as untrusted, non-authoritative inference. Scout free-form text never replaces the evidence.

The Scout call creates separate provider usage and cost. Its metrics are local and ephemeral. pi-advisor does not persist a Scout trajectory, add Scout data to Session Advisor Summary, send it to Herdr, or charge it against the Advisor-call budget. An ordinary Scout failure uses the original conversation; parent cancellation stops the complete operation.

## Outcome logging

`advisorOutcomeLogging` defaults to `false` and is global-only: a project config cannot enable it.

When enabled, `~/.pi/agent/advisor-outcomes.jsonl` stores bounded, rotating JSONL records containing only a version, timestamp, salted truncated advice digest, trigger, adoption, and validation status. It stores no prompt, advice, paths, tool output, repository data, session ID, or advice ID.

## Session summary and Herdr

The optional Session Advisor Summary defaults to off. When enabled, it is local and in-memory only, appears after a non-blocked settled run, and is never persisted.

It distinguishes regular Markdown advice from gate decisions and records the trigger, model, usage and cost when available, failures, budget, and execution effect.

[Herdr](https://github.com/ogulcancelik/herdr) integration is enabled by default. It reports Advisor activity and a bounded, redacted blocked-state summary through Herdr's metadata paths. Disable it with `advisorHerdrIntegration`. Previously reported state is still cleared when integration is disabled.

See [Configuration](configuration.md) for all settings and defaults.
