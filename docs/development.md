# Development

## Local setup

```bash
git clone git@github.com:philipbrembeck/pi-advisor.git
cd pi-advisor
bun install
bun run build
```

Use Bun 1.4.3 or newer; the repository's `preinstall` check rejects older versions unless lifecycle scripts are disabled. The check skips packed installs, so package consumers don't need Bun. `bun run typecheck` uses the `bun check` command.

Pi loads `dist/index.js`, which bundles internal modules so settings controls and persistence share the same runtime state. Run `bun run build` once after checkout, then reload Pi. The pre-commit hook rebuilds and stages the bundle after linting source changes; `prepack` also rebuilds it for npm packaging.

A rebuilt bundle is not always picked up by `/reload` in a running process: the in-process module cache can keep serving the previous `dist/index.js`. After rebuilding, verify the change is live (for example, check new tool-result fields) or fully restart Pi and continue the session with `pi -c`.

## Checks

Run the full project checks before opening a pull request:

```bash
bun run test
bun run typecheck
bun run check:boundaries
bun run lint
bun run package:check
bun audit --audit-level=high
git -c diff.stat=false diff --no-ext-diff --check --no-stat
```

`bun test` covers the normal suite. Run `bun run test:bench` for the repository-only benchmark tests.

`src/tools/register-ask-advisor.ts` exceeds the usual ~300-line target because registration and the sequential screening, budget, one-shot handoff, streaming, and error cleanup path share one ordered execution boundary; splitting that boundary risks changing when a call becomes chargeable or consumes consent.

GitHub Actions manages release tags and publishing from `package.json`. Do not create release tags manually.
