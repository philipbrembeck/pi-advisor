---
date: 2026-07-18T21:33:07.566066+00:00
git_commit: e18564d42fff7509301c151294270495d21ea094
branch: main
topic: "Herdr agent states and an Advisor-active display"
tags: [research, herdr, agent-states, pi, advisor]
status: complete
---

# Research: Herdr agent states and an Advisor-active display

## Research Question

What states does Herdr assign to agents, and can Pi show a distinct `seeking advice` status while an Advisor consultation is active rather than simply `working`?

## Summary

Herdr has four semantic agent states: `idle`, `working`, `blocked`, and `unknown`. Its UI additionally renders an unseen `idle` agent as `done`; `done` is not a fifth semantic state.

A new semantic state is not extensible through an integration: Herdr's state enum, manifests, socket API, wait behavior, notifications, and sidebar rollups all use the four-state model. However, Herdr explicitly supports a display-only state-label override through `pane.report_metadata`. A Pi-side extension can set the display label for semantic `working` to `seeking advice` at consultation start, then clear that metadata when the consultation completes, fails, or is cancelled. Semantic state remains `working`, so wait behavior and workspace rollups remain unchanged.

## State Model

| Semantic state | Meaning | Sidebar presentation |
| --- | --- | --- |
| `idle` | Agent has finished and its prompt is visible | `idle` after it is seen; `done` while unseen |
| `working` | Agent is actively processing | `working` |
| `blocked` | Agent needs human input | `blocked` |
| `unknown` | Plain shell or unrecognized program | `unknown` internally; some UI surfaces label it `idle` |

`done` is a presentation state derived from `(idle, unseen)`, not an `AgentState` enum value.

## Current Pi Integration

Herdr's installed Pi extension reports lifecycle state through its local socket integration. It uses `pane.report_agent` with agent label `pi` and source `herdr:pi`; its state type only allows `working`, `blocked`, and `idle`.

The Pi Advisor extension starts a manual consultation asynchronously and already has explicit completion, failure, cancellation, and session-shutdown paths. Those boundaries are suitable places to set and clear a display-only Advisor activity marker, without becoming a competing lifecycle authority.

## Display-Only Advisor Label

Herdr documents `pane.report_metadata` for exactly this situation: a user hook that runs alongside a Herdr-managed integration. A metadata report can include:

```json
{
  "method": "pane.report_metadata",
  "params": {
    "pane_id": "w1:p1",
    "source": "user:pi-advisor",
    "agent": "pi",
    "applies_to_source": "herdr:pi",
    "state_labels": { "working": "seeking advice" }
  }
}
```

The matching clear report removes the `working` label override. Herdr's process environment provides `HERDR_ENV`, `HERDR_SOCKET_PATH`, and `HERDR_PANE_ID` to managed panes; its own Pi integration uses the same values and newline-delimited JSON socket protocol.

This changes visible text only. Herdr documents that metadata never alters semantic state, waits, notifications, workspace rollups, or native session restoration.

## Code and Documentation References

- Herdr source, [`src/detect/mod.rs:10-20`](https://github.com/ogulcancelik/herdr/blob/a51a15914a5b29155022a1fd589d2bcc6409cadf/src/detect/mod.rs#L10-L20): `AgentState` defines `Idle`, `Working`, `Blocked`, and `Unknown`.
- Herdr source, [`src/detect/manifest.rs:217-231`](https://github.com/ogulcancelik/herdr/blob/a51a15914a5b29155022a1fd589d2bcc6409cadf/src/detect/manifest.rs#L217-L231): manifests accept those same four states.
- Herdr source, [`src/ui/sidebar.rs:174-180`](https://github.com/ogulcancelik/herdr/blob/a51a15914a5b29155022a1fd589d2bcc6409cadf/src/ui/sidebar.rs#L174-L180): `done` derives from unseen `Idle`.
- Herdr source, [`src/integration/assets/pi/herdr-agent-state.ts`](https://github.com/ogulcancelik/herdr/blob/a51a15914a5b29155022a1fd589d2bcc6409cadf/src/integration/assets/pi/herdr-agent-state.ts): installed Pi integration and socket request pattern.
- [Herdr Agents documentation](https://herdr.dev/docs/agents/): state authority, lifecycle hooks, and state rollups.
- [Herdr Integrations documentation](https://herdr.dev/docs/integrations/): Pi is a lifecycle authority and metadata is intended for neighboring user hooks.
- [Herdr Socket API: Agent state reporting](https://herdr.dev/docs/socket-api/#agent-state-reporting): metadata fields, allowed state-label keys, and their display-only behavior.

## Open Questions

- Whether the desired label should apply only to `/advisor-manual` consultations or also to automatic `ask_advisor` calls.
- Whether the label should include the optional focused question as a sidebar token or remain the fixed `Calling Advisor` text.
