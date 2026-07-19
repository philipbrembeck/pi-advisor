# AGENTS.md — pi-advisor

Pi extension providing an Executor/Advisor flow and optional Herdr integration.

## Stack

| Layer         | Tool                              |
| ------------- | --------------------------------- |
| Runtime       | Bun + TypeScript (ESM, strict)    |
| Extension API | `@earendil-works/pi-coding-agent` |
| UI            | `@earendil-works/pi-tui`          |
| Tests         | `bun test`                        |
| Release       | GitHub Actions on `vX.Y.Z` tags   |

## Development

```bash
bun test
bun run typecheck
git -c diff.stat=false diff --no-ext-diff --check --no-stat
```

## Rules

- MUST read Pi extension docs before changing lifecycle hooks, tool blocking, messages, or renderers.
- MUST treat tool-action blocking and session blocking as different controls; MUST NOT silently escalate one into the other.
- MUST surface Advisor, auth, or Herdr failures to the user and preserve the intended safety state.
- MUST reuse existing Advisor call/response renderers; MUST NOT put Advisor output in a raw tool-block reason when a rendered message is expected.
- MUST verify runtime-flow and UI changes in the reloaded TUI; unit tests alone are insufficient.
- MUST compare the rendered call, streaming state, response, error, and blocked state against the existing Advisor UI before reporting UI work complete.
- MUST use the appropriate UI surface: rendered custom message for Advisor activity, tool result for tool outcomes, notification only for brief status/errors.
- MUST add tests for every setting: defaults, validation, persistence, and UI navigation.
- MUST keep session summaries local and ephemeral; MUST NOT send them to Herdr or persist them.
- MUST document released user-facing behavior in README and CHANGELOG; MUST NOT document internal iterations or unreleased defects.
- MUST preserve public `advisor.json` fields and unknown fields when saving configuration.
- MUST run all checks above before reporting completion. MUST NOT commit, push, or tag unless asked.

## Common pitfalls

- Any new Advisor invocation MUST visually match an Executor `ask_advisor` call exactly: the same call box, streaming state, response renderer, and error treatment. A toast or raw tool-block text is not equivalent UI.

## Load when needed

| What             | Where                           | When                                 |
| ---------------- | ------------------------------- | ------------------------------------ |
| Pi extension API | Pi docs `docs/extensions.md`    | Hooks, tools, UI, sessions, messages |
| Herdr protocol   | `src/herdr.ts` and project docs | Herdr state/reporting changes        |
| Release workflow | `.github/workflows/publish.yml` | Versioning, publishing, tags         |
