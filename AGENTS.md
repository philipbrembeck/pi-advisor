# AGENTS.md — pi-advisor

Pi extension providing an Executor/Advisor flow and optional Herdr integration.

## Stack

| Layer         | Tool                              |
| ------------- | --------------------------------- |
| Runtime       | Bun + TypeScript (ESM, strict)    |
| Extension API | `@earendil-works/pi-coding-agent` |
| UI            | `@earendil-works/pi-tui`          |
| Tests         | `bun test`                        |
| Release       | GitHub Actions manages tags/publishing |

## Development

```bash
bun test
bun run typecheck
git -c diff.stat=false diff --no-ext-diff --check --no-stat
```

## Source organization

- Keep individual source files below roughly 300 lines where practical, split distinct responsibilities into cohesive modules, and document justified exceptions. This is soft guidance rather than an automated size gate.

## Rules

- The four `src/*.ts` facades (`config.ts`, `ui.ts`, `tools.ts`, `commands.ts`) are a frozen deep-import compatibility surface: every re-exported value is pinned by name in `test/facade-exports.test.ts`. Do not add new public symbols to a facade without extending that test; do not remove or move re-exports without a breaking-release decision.
- MUST read Pi extension docs before changing lifecycle hooks, tool blocking, messages, or renderers.
- MUST treat tool-action blocking and session blocking as different controls; MUST NOT silently escalate one into the other.
- MUST surface Advisor, auth, or Herdr failures to the user and preserve the intended safety state.
- MUST reuse existing Advisor call/response renderers; MUST NOT put Advisor output in a raw tool-block reason when a rendered message is expected.
- MUST verify runtime-flow and UI changes in the reloaded TUI; unit tests alone are insufficient.
- MUST compare the rendered call, streaming state, response, error, and blocked state against the existing Advisor UI before reporting UI work complete.
- MUST use the appropriate UI surface: rendered custom message for Advisor activity, tool result for tool outcomes, notification only for brief status/errors.
- MUST add tests for every setting: defaults, validation, persistence, and UI navigation.
- MUST keep session summaries local and ephemeral; MUST NOT send them to Herdr or persist them.
- MUST document released user-facing behavior in README and CHANGELOG; MUST NOT document internal iterations, implementation reversions, or unreleased defects. Describe the delivered user outcome, not what was temporarily changed during development.
- MUST preserve public `advisor.json` fields and unknown fields when saving configuration.
- MUST commit completed, validated increments as often as practical while working so progress is not lost. Do not commit partial or failing work.
- MUST run all checks above before reporting completion. MUST NOT push unless asked. MUST NOT create or push release tags during normal work: CI manages tagging from `package.json`.
- When a release workflow fails before npm publication, MUST verify that the package version is absent from npm, remove the failed local and remote Git tag, apply the correction without bumping the version, push the correction, recreate and push the same version tag manually, and manually dispatch the publish workflow. MUST preserve the intended semver release; never substitute an alternate patch version.
- When npm publication has succeeded, MUST treat that version as immutable: never remove, replace, or republish it. Any later correction requires an explicitly approved new semver release.
- MUST document a release incident in `CHANGELOG.md` and this file after containment, including the failed release identity, observed failure, and the recovery outcome. Do not hide an incident as an internal test-only change.

## Common pitfalls

- Any new Advisor invocation MUST visually match an Executor `ask_advisor` call exactly: the same call box, streaming state, response renderer, and error treatment. A toast or raw tool-block text is not equivalent UI.

## Load when needed

| What             | Where                                                                                                                                            | When                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Pi extension API | [Pi extension docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) | Hooks, tools, UI, sessions, messages |
| Herdr protocol   | [project guide](docs/herdr.md), [`src/herdr.ts`](src/herdr.ts), and [upstream stable API](https://herdr.dev/docs/socket-api/)                     | Herdr state/reporting changes        |
| Release workflow | [`.github/workflows/publish.yml`](.github/workflows/publish.yml)                                                                                  | Versioning, publishing, tags         |
