# Development

## Local setup

```bash
git clone git@github.com:philipbrembeck/pi-advisor.git
cd pi-advisor
bun install
bun run build
```

Pi loads `dist/index.js`, which bundles internal modules so settings controls and
persistence share the same runtime state. Run `bun run build` once after
checkout, then reload Pi. The pre-commit hook rebuilds and stages the bundle
after linting source changes; `prepack` also rebuilds it for npm packaging.

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

GitHub Actions manages release tags and publishing from `package.json`. Do not create release tags manually.
