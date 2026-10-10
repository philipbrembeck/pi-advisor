---
date: 2026-10-10T15:41:19.378734+00:00
git_commit: ff7ee274abca7545cb9565cb0f712bc851eff1ea
branch: main
topic: "Herdr integration/API compatibility and new capabilities"
tags: [research, herdr, socket-api, pi, integration]
status: complete
---

# Research: Herdr integration/API compatibility and new capabilities

## Research question

Does pi-advisor's Herdr integration need updates, has the Herdr API changed, and are new capabilities available?

## Summary

- The installed Herdr is **0.9.3**, socket protocol **22**, schema version **1**. The repository guide still documents 0.8.0/protocol 19 and 0.7.5/protocol 17.
- The existing pi-advisor requests remain compatible. Representative activity, block, clear, and notification payloads all validated against the installed 0.9.3 JSON schema.
- The metadata-only boundary is still correct. Herdr's bundled `herdr:pi` integration owns Pi's semantic lifecycle state and session restore. pi-advisor should not add competing `pane.report_agent`, `pane.report_agent_session`, `resume_argv`, or `pane.release_agent` reporting.
- The local Herdr-managed Pi integration is outdated: `herdr integration status` reports **v8 < v9**. This is a managed file outside this repository and can be updated with `herdr integration install pi`.
- The current Herdr API exposes useful optional metadata features—pane title, displayed agent name, arbitrary sidebar tokens, token TTLs, and explicit clear flags—but pi-advisor does not currently need them. The existing `seeking advice` and bounded `blocked` labels are the narrower privacy-preserving fit.
- The main repository follow-up is documentation and transport review, not an urgent API migration.

## Current integration shape

```text
Advisor consultation/gate
        |
        +--> pane.report_metadata  (display-only activity/block labels)
        |
        +--> pi.events herdr:blocked --> Herdr's herdr:pi lifecycle integration
        |
        +--> notification.show      (failure/budget toast)
```

Key files:

- `src/herdr-shared.ts:13-108` defines request types, redaction, sequence values, socket discovery, and transport.
- `src/herdr.ts:20-153` reports activity metadata, notifications, and integration enablement.
- `src/herdr-block.ts:27-94` reports bounded block labels and emits semantic block edges.
- `extensions/index.ts:35-55` creates runtime-scoped activity/block adapters and emits `herdr:blocked` on the owning Pi event bus.
- `src/commands/manual-consultation.ts:52-183` brackets manual consultations with activity start/finish and sends failure notifications.
- `src/commands/lifecycle.ts:75-93` clears the owning runtime's activity leases at shutdown.
- `test/herdr.test.ts:24-268` covers sanitization, overlap, runtime scoping, disablement, clearing, and failure isolation.

## API comparison

### Compatible requests

The installed schema accepts all fields currently emitted by pi-advisor:

- `pane.report_metadata`: `pane_id`, `source`, `agent`, `applies_to_source`, `state_labels`, `clear_state_labels`, and `seq`.
- `notification.show`: sanitized `title`, `body`, `position: "top-left"`, and `sound: "request"`.

Validation used actual requests produced by `HerdrAdvisorActivity`, `HerdrAdvisorBlock`, and `createHerdrNotificationRequest` against `herdr api schema --json`:

```text
1 pane.report_metadata PASS
2 pane.report_metadata PASS
3 pane.report_metadata PASS
4 pane.report_metadata PASS
5 notification.show PASS
```

Herdr still treats `pane.report_metadata` as presentation-only. It does not change semantic `working`, `blocked`, waits, notifications, rollups, or native session restore. The existing `agent: "pi"` and `applies_to_source: "herdr:pi"` guards therefore remain important.

### New or expanded capabilities

Current 0.9.3 metadata supports:

- `title`, `display_agent`, `clear_title`, and `clear_display_agent`.
- State-label keys for `idle`, `working`, `blocked`, `done`, and `unknown`.
- Up to 16 named token patches per report, with `null` clearing and optional `ttl_ms` from 1 ms to 24 hours.
- Token values exposed in pane/agent responses and renderable in Herdr sidebar rows.

Potential uses include a short-lived static Advisor token or a more descriptive pane title. Sending the user's question, Advisor response, session summary, model context, or repository content would violate the existing privacy boundary; `docs/privacy.md:94-102` explicitly keeps that data local.

Current 0.9.2+ lifecycle support also allows an agent integration to report:

- `pane.report_agent` with semantic state and optional session/resume data.
- `pane.report_agent_session` for session identity and `resume_argv`.
- `pane.release_agent` on exit.

Those capabilities belong to the authoritative Pi integration already installed by Herdr. Adding them to pi-advisor would create competing state/session ownership and contradict the existing `herdr:blocked` design documented in `docs/herdr.md:80-118`.

`notification.show` now returns `shown` plus a reason such as `shown`, `disabled`, `rate_limited`, `no_foreground_client`, or `busy`. pi-advisor currently sends the request fire-and-forget and does not inspect that result.

## Compatibility and maintenance findings

1. **Installed managed integration needs an update.**

   ```text
   herdr 0.9.3
   pi: outdated (v8 < v9) (.../.pi/agent/extensions/herdr-agent-state.ts)
   ```

   Run `herdr integration install pi` to let Herdr replace its managed extension. Do not edit that generated file manually.

2. **The repository compatibility guide is stale.**

   `docs/herdr.md:5-10` names only 0.8.0/0.7.5. It should record the 0.9.3/protocol-22/schema-1 verification separately from older compatibility claims and describe the new metadata/resume capabilities without implying pi-advisor uses all of them. `docs/privacy.md:100` also links the old `ogulcancelik/herdr` repository instead of the current `herdrdev/herdr` location.

3. **Transport reliability is a candidate hardening change, not an API break.**

   `src/herdr-shared.ts:76-94` makes one 500 ms socket attempt and discards the response. The current bundled Herdr Pi integration retries after 500 ms with a 1500 ms attempt and queues state reports. That pattern should not be copied blindly: retrying `notification.show` can duplicate a delivered toast, while independent metadata sockets can arrive out of order even though `seq` rejects stale updates. Any transport change needs explicit ordering, duplicate-delivery, response/error, and timeout tests.

4. **No current breaking API change affects pi-advisor.**

   Herdr 0.9.2 removed its pane graphics API and added self-reported resume commands. pi-advisor uses neither the graphics API nor semantic lifecycle reporting, so those changes do not require a runtime migration here.

## Validation

- `herdr --version` → `herdr 0.9.3`.
- `herdr api schema --json` → protocol 22, schema version 1.
- Representative emitted payloads validated against the exported schema.
- `bun test test/herdr.test.ts` → 11 pass, 0 fail.
- `bun run typecheck` → no type errors in 227 files.
- `herdr integration status` identified the installed Pi integration as v8 while v9 is current.

A live Herdr-hosted Pi TUI reload was not performed during this audit, and no repository source files were changed.

## Sources

- Herdr [Socket API](https://herdr.dev/docs/socket-api/)
- Herdr [Integrations](https://herdr.dev/docs/integrations/)
- Herdr [Add Herdr support to your agent](https://herdr.dev/docs/add-herdr-support/)
- Herdr [0.9.3 changelog](https://github.com/herdrdev/herdr/blob/master/CHANGELOG.md)
- Herdr [bundled Pi integration](https://github.com/herdrdev/herdr/blob/master/src/integration/assets/pi/herdr-agent-state.ts)
- `docs/herdr.md`
- `src/herdr-shared.ts`
- `src/herdr.ts`
- `src/herdr-block.ts`
